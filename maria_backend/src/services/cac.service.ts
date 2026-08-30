import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII, mergeSealedPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * CAC Services — business name / company registration.
 *
 * There is no provider API for this anywhere in the codebase (unlike NIN/BVN,
 * which go through Techhub). It follows the exact same manual pattern as NIN
 * Modification (see nin-modification.service.ts) and BVN License Onboarding:
 * the customer is debited at submission, the transaction sits PENDING, and an
 * admin does the actual CAC filing by hand. Three things an admin can do from
 * the "manage" page (see admin/cac.ts):
 *   - Download the auto-generated submission PDF (every field the customer
 *     supplied) - this is what they'd actually take to the CAC portal to
 *     register the business, same idea as BVN License Onboarding's
 *     submission PDF.
 *   - Save progress notes, visible to the customer on their history table
 *     (matches the reference design's "Progress Notes" column).
 *   - Mark it complete and attach the FINAL certificate PDF (the one CAC
 *     issues once registration is done), which the customer can then
 *     download - this is a second, separate PDF from the submission one
 *     above.
 *
 * "Company more than 1M, NGO, Clubs, Association, Etc." has no fixed price
 * in the reference design ("quote on request") and isn't included in
 * CAC_TYPES below - support currently handles that one manually outside the
 * app rather than through a zero-price submission.
 */
export const CAC_TYPES = ['sole', 'partnership', 'llc'] as const;
export type CacType = (typeof CAC_TYPES)[number];

const CAC_CONFIG: Record<CacType, { title: string; price: number }> = {
  sole: { title: 'Business Name — Sole Proprietorship', price: 28000 },
  partnership: { title: 'Business Name — Partnership', price: 32000 },
  llc: { title: 'Limited Liability — 1M Share', price: 40000 }
};

/**
 * The applicant/proprietor details actually needed to file with CAC - a
 * business name/company alone isn't enough to register anything. Kept as a
 * flat, mostly-generic dict (like BvnLicenseInput in
 * bvn-license-onboarding.service.ts) so the submission PDF can just loop
 * over every field without a hand-maintained render function per field.
 */
export type CacApplicantDetails = {
  business_nature: string;
  business_address: string;
  proprietor_full_name: string;
  proprietor_phone: string;
  proprietor_email: string;
  proprietor_residential_address: string;
  proprietor_date_of_birth: string;
  proprietor_gender: 'Male' | 'Female';
  proprietor_nin: string;
};

function serviceKeyFor(type: CacType) {
  return `CAC_${type.toUpperCase()}`;
}

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

/** Same plain-findUnique-then-conditional-create shape used throughout this
 *  codebase's pricing lookups (see getOrCreatePricingRow in
 *  nin-modification.service.ts) - never resets an admin's already-configured
 *  price back to the default. */
async function getOrCreatePricingRow(type: CacType) {
  const config = CAC_CONFIG[type];
  const service = serviceKeyFor(type);
  const existing = await prisma.servicePricing.findUnique({ where: { service } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service,
        provider: 'manual',
        label: config.title,
        providerCostKobo: priceToKobo(config.price)
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.servicePricing.findUniqueOrThrow({ where: { service } });
    }
    throw error;
  }
}

export async function getCacPrice(type: CacType) {
  const row = await getOrCreatePricingRow(type);
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

/** Public price list - never throws on a disabled service. */
export async function listCacPrices() {
  const rows = await Promise.all(CAC_TYPES.map((type) => getOrCreatePricingRow(type)));
  return rows.map((row, index) => ({
    type: CAC_TYPES[index],
    title: CAC_CONFIG[CAC_TYPES[index]].title,
    unitPrice: koboToNaira(row.sellingPriceKobo ?? row.providerCostKobo),
    isActive: row.isActive
  }));
}

function createCacReference() {
  return `CAC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** Renders every submitted field into a simple PDF the admin can print or
 *  upload straight into the CAC portal's forms - same pattern as
 *  bvn-license-onboarding.service.ts's renderPdf. */
async function renderSubmissionPdf(params: {
  cacType: CacType;
  proposedName1: string;
  proposedName2?: string | null;
  details: CacApplicantDetails;
  trackingRef: string;
}) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<string>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);
  });

  doc.fontSize(18).fillColor('#0b2f73').text('CAC Business Registration — Submission Form', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#374151').text(`Reference: ${params.trackingRef}`);
  doc.text(`Submitted: ${new Date().toISOString()}`);
  doc.text(`Registration type: ${CAC_CONFIG[params.cacType].title}`);
  doc.moveDown();

  doc.fontSize(13).fillColor('#0b2f73').text('Proposed Business Name(s)');
  doc.fontSize(10).fillColor('#374151').text(`Option 1: ${params.proposedName1}`);
  if (params.proposedName2) doc.text(`Option 2: ${params.proposedName2}`);
  doc.moveDown();

  doc.fontSize(13).fillColor('#0b2f73').text('Business Details');
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Nature of business: ${params.details.business_nature}`);
  doc.text(`Business address: ${params.details.business_address}`);
  doc.moveDown();

  doc.fontSize(13).fillColor('#0b2f73').text('Proprietor / Applicant Details');
  doc.fontSize(10).fillColor('#374151');
  doc.text(`Full name: ${params.details.proprietor_full_name}`);
  doc.text(`Phone: ${params.details.proprietor_phone}`);
  doc.text(`Email: ${params.details.proprietor_email}`);
  doc.text(`Residential address: ${params.details.proprietor_residential_address}`);
  doc.text(`Date of birth: ${params.details.proprietor_date_of_birth}`);
  doc.text(`Gender: ${params.details.proprietor_gender}`);
  doc.text(`NIN: ${params.details.proprietor_nin}`);

  doc.moveDown(2);
  doc.fontSize(9).fillColor('#6b7280').text('Generated automatically at submission time for manual CAC filing. Not a CAC certificate.');
  doc.end();
  return done;
}

export type SubmitCacResult = { reference: string; balanceAfter: number };

export async function submitCacRequest(params: {
  userId: string;
  type: CacType;
  proposedName1: string;
  proposedName2?: string;
  details: CacApplicantDetails;
  idempotencyKey?: string;
}): Promise<SubmitCacResult> {
  const config = CAC_CONFIG[params.type];
  const price = await getCacPrice(params.type);
  const service = serviceKeyFor(params.type);
  const trackingRef = createCacReference();

  const submissionPdfBase64 = await renderSubmissionPdf({
    cacType: params.type,
    proposedName1: params.proposedName1,
    proposedName2: params.proposedName2,
    details: params.details,
    trackingRef
  });

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.CAC_SERVICE_REQUEST,
    description: `CAC Services — ${config.title}`,
    metadata: {
      service,
      cac_type: params.type,
      unit_price: price.unitPrice,
      progress_notes: null,
      tracking_ref: trackingRef,
      pii: sealPII({
        proposed_name_1: params.proposedName1,
        proposed_name_2: params.proposedName2 ?? null,
        ...params.details,
        submission_pdf_base64: submissionPdfBase64
      })
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // No provider was actually paid yet - an admin pays CAC's fee when they
    // manually file this. Same reasoning as NIN Modification's costKobo.
    costKobo: price.providerCostKobo
  });

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type CacHistoryEntry = {
  reference: string;
  status: string;
  cac_type: string | null;
  proposed_name_1: string | null;
  proposed_name_2: string | null;
  amount: number;
  progress_notes: string | null;
  submission_pdf_base64: string | null;
  certificate_pdf_base64: string | null;
  created_at: string;
  updated_at: string;
};

type CacPII = Partial<CacApplicantDetails> & {
  proposed_name_1?: string;
  proposed_name_2?: string | null;
  submission_pdf_base64?: string;
  certificate_pdf_base64?: string;
};

/**
 * Unlike NIN Modification's history (which only ever shows SUCCESS rows,
 * see listModificationHistory), CAC registration can take days - the whole
 * point of this table (matching the reference design's "Transactions" grid)
 * is for the customer to track a request while it's still PENDING, so every
 * status is included here, not just completed ones.
 */
export async function listCacHistory(userId: string) {
  const transactions = await prisma.transaction.findMany({
    where: { userId, type: TransactionType.CAC_SERVICE_REQUEST },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return transactions.map((transaction): CacHistoryEntry => {
    const metadata = transaction.metadata as Record<string, unknown> | null;
    const pii = openPII<CacPII>(metadata?.pii);
    return {
      reference: transaction.reference,
      status: transaction.status.toLowerCase(),
      cac_type: typeof metadata?.cac_type === 'string' ? metadata.cac_type : null,
      proposed_name_1: pii?.proposed_name_1 ?? null,
      proposed_name_2: pii?.proposed_name_2 ?? null,
      amount: koboToNaira(transaction.amountKobo),
      progress_notes: typeof metadata?.progress_notes === 'string' ? metadata.progress_notes : null,
      submission_pdf_base64: typeof pii?.submission_pdf_base64 === 'string' ? pii.submission_pdf_base64 : null,
      certificate_pdf_base64: typeof pii?.certificate_pdf_base64 === 'string' ? pii.certificate_pdf_base64 : null,
      created_at: transaction.createdAt.toISOString(),
      updated_at: transaction.updatedAt.toISOString()
    };
  });
}

/** Admin-only: update the customer-visible progress note without changing status. */
export async function updateCacProgressNotes(params: { transactionId: string; notes: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.CAC_SERVICE_REQUEST) {
    throw new ApiError(404, 'CAC transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: { metadata: { ...metadata, progress_notes: params.notes } as Prisma.InputJsonValue }
  });
}

/**
 * Admin-only: attaches the completed certificate and marks the request
 * SUCCESS. Called once the admin has actually finished the CAC filing -
 * there is no automatic path here, unlike verification.service.ts's
 * Techhub-backed purchases.
 */
export async function completeCacRequest(params: { transactionId: string; certificatePdfBase64: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.CAC_SERVICE_REQUEST) {
    throw new ApiError(404, 'CAC transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending CAC request can be marked complete', 'INVALID_STATUS');
  }

  const metadata = (transaction.metadata as Record<string, unknown> | null) ?? {};
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: TransactionStatus.SUCCESS,
      metadata: {
        ...metadata,
        pii: mergeSealedPII(metadata.pii, { certificate_pdf_base64: params.certificatePdfBase64 })
      } as Prisma.InputJsonValue
    }
  });
}

/** Decrypts the sealed PII (applicant details, submission PDF, certificate) for the admin's manage page. Never call from a user-facing endpoint. */
export function decryptCacPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<CacPII>(metadata?.pii);
}
