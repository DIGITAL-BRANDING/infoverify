import PDFDocument from 'pdfkit';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { koboToNaira } from '../lib/money.js';
import { sealPII, openPII } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { debitWallet } from './wallet.service.js';

/**
 * BVN Modification — same manual pattern as NIN Modification
 * (nin-modification.service.ts), for BVN instead: there is no provider API
 * for updating a BVN's details, so submitBvnModificationRequest() debits
 * the wallet, generates a PDF of exactly what the customer submitted, and
 * leaves the transaction PENDING. An admin then processes the change by
 * hand (bank/NIBSS agent portal) and, from the Transaction admin page,
 * either marks it complete (completeBvnModification()) or rejects it (the
 * existing generic "reverse" action, which refunds).
 *
 * Every type asks for the account number + bank name alongside the BVN
 * itself, since that's the minimum an agent portal needs to actually locate
 * and verify the record before changing anything on it.
 */
export const BVN_MODIFICATION_TYPES = ['update_phone', 'update_name', 'update_dob', 'update_address', 'update_email'] as const;

export type BvnModificationType = (typeof BVN_MODIFICATION_TYPES)[number];

export type BvnModificationFieldInput = 'text' | 'date' | 'phone' | 'email' | 'bvn';

export type BvnModificationField = {
  key: string;
  label: string;
  required: boolean;
  input: BvnModificationFieldInput;
};

type BvnModificationTypeConfig = {
  id: BvnModificationType;
  title: string;
  price: number;
  fields: BvnModificationField[];
};

// Every type starts with these three - the minimum an agent portal needs to
// locate and verify the record before changing anything on it.
const identifyingFields: BvnModificationField[] = [
  { key: 'bvn', label: 'BVN Number', required: true, input: 'bvn' },
  { key: 'account_number', label: 'Account Number', required: true, input: 'text' },
  { key: 'bank_name', label: 'Bank Name', required: true, input: 'text' }
];

export const BVN_MODIFICATION_CONFIG: Record<BvnModificationType, BvnModificationTypeConfig> = {
  update_phone: {
    id: 'update_phone',
    title: 'Update Phone Number',
    price: 3500,
    fields: [...identifyingFields, { key: 'new_phone_number', label: 'New Phone Number', required: true, input: 'phone' }]
  },
  update_name: {
    id: 'update_name',
    title: 'Update Name',
    price: 5000,
    fields: [
      ...identifyingFields,
      { key: 'new_first_name', label: 'New First Name', required: true, input: 'text' },
      { key: 'new_last_name', label: 'New Last Name', required: true, input: 'text' },
      { key: 'new_middle_name', label: 'New Middle Name', required: false, input: 'text' }
    ]
  },
  update_dob: {
    id: 'update_dob',
    title: 'Update Date of Birth',
    price: 5000,
    fields: [...identifyingFields, { key: 'new_date_of_birth', label: 'New Date of Birth', required: true, input: 'date' }]
  },
  update_address: {
    id: 'update_address',
    title: 'Update Address',
    price: 3500,
    fields: [
      ...identifyingFields,
      { key: 'new_address', label: 'New Address', required: true, input: 'text' },
      { key: 'new_state', label: 'State', required: true, input: 'text' },
      { key: 'new_lga', label: 'L.G.A', required: true, input: 'text' }
    ]
  },
  update_email: {
    id: 'update_email',
    title: 'Update Email Address',
    price: 3000,
    fields: [...identifyingFields, { key: 'new_email', label: 'New Email Address', required: true, input: 'email' }]
  }
};

function priceToKobo(amount: number) {
  return BigInt(Math.round(amount * 100));
}

function serviceKeyFor(type: BvnModificationType) {
  return `BVN_MODIFICATION_${type.toUpperCase()}`;
}

/** Same plain-findUnique-then-conditional-create shape as
 *  getOrCreatePricingRow() in nin-modification.service.ts - never resets an
 *  admin's already-configured price back to the default. */
async function getOrCreatePricingRow(type: BvnModificationType) {
  const config = BVN_MODIFICATION_CONFIG[type];
  const service = serviceKeyFor(type);
  const existing = await prisma.servicePricing.findUnique({ where: { service } });
  if (existing) return existing;

  try {
    return await prisma.servicePricing.create({
      data: {
        service,
        provider: 'manual',
        label: `BVN Modification \u2014 ${config.title}`,
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

export async function getBvnModificationPrice(type: BvnModificationType) {
  const row = await getOrCreatePricingRow(type);
  if (!row.isActive) {
    throw new ApiError(422, `${row.label} is currently unavailable`, 'SERVICE_INACTIVE');
  }
  const unitKobo = row.sellingPriceKobo ?? row.providerCostKobo;
  return { unitPrice: koboToNaira(unitKobo), providerCostKobo: row.providerCostKobo };
}

/** Public price list, keyed by modification type id - never throws on a disabled service. */
export async function listBvnModificationPrices() {
  const rows = await Promise.all(BVN_MODIFICATION_TYPES.map((type) => getOrCreatePricingRow(type)));
  return rows.map((row, index) => ({
    type: BVN_MODIFICATION_TYPES[index],
    title: BVN_MODIFICATION_CONFIG[BVN_MODIFICATION_TYPES[index]].title,
    unitPrice: koboToNaira(row.sellingPriceKobo ?? row.providerCostKobo),
    isActive: row.isActive
  }));
}

/** Renders exactly what the customer submitted into a one-page PDF - the
 *  document an admin opens to manually process the change, and the copy
 *  the customer can re-download from their own history. */
function renderBvnModificationPdf(params: {
  reference: string;
  type: BvnModificationType;
  fields: BvnModificationField[];
  values: Record<string, unknown>;
  submittedAt: Date;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    const config = BVN_MODIFICATION_CONFIG[params.type];

    doc.fontSize(16).font('Helvetica-Bold').text('MARIA Digital Solutions \u2014 BVN Modification Request', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555').text(config.title, { align: 'center' });
    doc.moveDown(1);
    doc.fillColor('#000');

    doc.fontSize(10).font('Helvetica-Bold').text('Reference: ', { continued: true }).font('Helvetica').text(params.reference);
    doc.font('Helvetica-Bold').text('Submitted: ', { continued: true }).font('Helvetica').text(params.submittedAt.toISOString());
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(1);

    for (const field of params.fields) {
      const raw = params.values[field.key];
      const value = raw === undefined || raw === null || raw === '' ? '\u2014' : String(raw);
      doc.font('Helvetica-Bold').fontSize(10).text(`${field.label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#888')
      .text('This is a submission record only, not a bank/NIBSS-issued confirmation. Processed manually by an admin.', { align: 'left' });

    doc.end();
  });
}

export type SubmitBvnModificationResult = { reference: string; balanceAfter: number };

export async function submitBvnModificationRequest(params: {
  userId: string;
  type: BvnModificationType;
  values: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<SubmitBvnModificationResult> {
  const config = BVN_MODIFICATION_CONFIG[params.type];
  const price = await getBvnModificationPrice(params.type);
  const service = serviceKeyFor(params.type);

  const debit = await debitWallet({
    userId: params.userId,
    amount: price.unitPrice,
    type: TransactionType.BVN_MODIFICATION,
    description: `BVN Modification \u2014 ${config.title}`,
    metadata: {
      service,
      modification_type: params.type,
      unit_price: price.unitPrice,
      pii: sealPII(params.values)
    } as Prisma.InputJsonValue,
    idempotencyKey: params.idempotencyKey,
    // No provider was actually paid yet - an admin processes this by hand.
    // Same reasoning as NIN Modification's costKobo.
    costKobo: price.providerCostKobo
  });

  if (debit.reused) {
    return { reference: debit.reference, balanceAfter: debit.balanceAfter };
  }

  const pdfBase64 = await renderBvnModificationPdf({
    reference: debit.reference,
    type: params.type,
    fields: config.fields,
    values: params.values,
    submittedAt: debit.transaction.createdAt
  });

  await prisma.transaction.update({
    where: { id: debit.transaction.id },
    data: {
      metadata: {
        service,
        modification_type: params.type,
        unit_price: price.unitPrice,
        pii: sealPII({ ...params.values, pdf_base64: pdfBase64 })
      } as Prisma.InputJsonValue
    }
  });

  return { reference: debit.reference, balanceAfter: debit.balanceAfter };
}

export type BvnModificationHistoryEntry = {
  reference: string;
  status: string;
  created_at: string;
  pdf_base64: string | null;
  modification_type: string | null;
};

export async function listBvnModificationHistory(params: { userId: string; type?: BvnModificationType }) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    // A modification is a manual/asynchronous service. Do not expose a
    // pending request as a completed recent activity; begin its seven-day
    // visibility period only when completeBvnModification() sets SUCCESS.
    where: {
      userId: params.userId,
      type: TransactionType.BVN_MODIFICATION,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since }
    },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });

  return transactions
    .filter((transaction) => {
      if (!params.type) return true;
      const metadata = transaction.metadata as Record<string, unknown> | null;
      return metadata?.modification_type === params.type;
    })
    .map((transaction): BvnModificationHistoryEntry => {
      const metadata = transaction.metadata as Record<string, unknown> | null;
      const pii = openPII<{ pdf_base64?: string }>(metadata?.pii);
      return {
        reference: transaction.reference,
        status: transaction.status.toLowerCase(),
        created_at: transaction.updatedAt.toISOString(),
        pdf_base64: typeof pii?.pdf_base64 === 'string' ? pii.pdf_base64 : null,
        modification_type: typeof metadata?.modification_type === 'string' ? metadata.modification_type : null
      };
    });
}

/**
 * Called from the "Complete modification" admin action once the admin has
 * manually processed the change. No wallet movement - the customer was
 * already charged at submit time. Rejection uses the existing generic
 * refundWallet()/"reverse" admin action instead of a dedicated function
 * here, since it already does exactly what a rejection needs.
 */
export async function completeBvnModification(params: { transactionId: string }) {
  const transaction = await prisma.transaction.findUnique({ where: { id: params.transactionId } });
  if (!transaction || transaction.type !== TransactionType.BVN_MODIFICATION) {
    throw new ApiError(404, 'BVN Modification transaction not found', 'TRANSACTION_NOT_FOUND');
  }
  if (transaction.status !== TransactionStatus.PENDING) {
    throw new ApiError(422, 'Only a pending modification request can be marked complete', 'INVALID_STATUS');
  }
  return prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.SUCCESS } });
}

/** Decrypts the sealed PII (including the generated PDF) for the admin's PDF-download route. Never call this from a user-facing endpoint. */
export function decryptBvnModificationPII(transaction: { metadata: unknown }) {
  const metadata = transaction.metadata as Record<string, unknown> | null;
  return openPII<Record<string, unknown> & { pdf_base64?: string }>(metadata?.pii);
}
