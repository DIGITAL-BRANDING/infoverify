import { Router, type Request } from 'express';
import { z } from 'zod';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { GEO_POLITICAL_ZONES, submitBvnLicense } from '../services/bvn-license-onboarding.service.js';
import { CAC_TYPES, listCacHistory, listCacPrices, submitCacRequest, type CacType } from '../services/cac.service.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import { prisma } from '../lib/prisma.js';
import {
  checkBvnRetrievalStatus,
  checkDelinkingStatus,
  checkIpeClearanceStatus,
  checkNinValidationStatus,
  checkPersonalizationStatus,
  decryptTransactionPII,
  listServiceTickets,
  listVerificationPrices,
  purchaseBvnSlip,
  purchaseNinByDemographic,
  purchaseNinByNin,
  purchaseNinByPhone,
  submitBvnRetrieval,
  submitDelinking,
  submitIpeClearance,
  submitNinValidation,
  submitPersonalization
} from '../services/verification.service.js';

export const verificationRoutes = Router();

verificationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: Request) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

const ninSlipTier = z.enum(['premium', 'standard', 'regular', 'vnin']);
const ninPhoneSlipTier = z.enum(['premium', 'standard', 'regular']);
const bvnSlipTier = z.enum(['premium', 'standard']);
const ninValidationType = z.enum([
  'nin_validation',
  'no_record',
  'sim',
  'modification',
  'photo_error',
  'bank_validation',
  'v.nin_validation',
  'update_records'
]);

function slipResponse(result: Awaited<ReturnType<typeof purchaseNinByNin>>) {
  return {
    status: result.status,
    message: result.message,
    data: {
      reference: result.reference,
      user_data: result.userData ?? null,
      pdf_base64: result.pdfBase64 ?? null,
      pdf_url: result.pdfUrl ?? null,
      balance_after: result.balanceAfter
    }
  };
}

// ── Prices ───────────────────────────────────────────────────────

verificationRoutes.get('/prices', async (_req, res) => {
  const prices = await listVerificationPrices();
  res.json({ status: true, data: prices });
});

verificationRoutes.post('/bvn/license-onboarding', async (req, res) => {
  const body = z.object({
    agent_location: z.string().trim().min(2),
    bvn: z.string().trim().length(11),
    nin: z.string().trim().length(11),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    middle_name: z.string().trim().max(100).optional(),
    phone_number: z.string().trim().length(11),
    date_of_birth: z.string().trim().min(8),
    email: z.string().trim().email(),
    alternative_email: z.string().trim().email().optional().or(z.literal('')),
    account_number: z.string().trim().min(10).max(12),
    bank_name: z.string().trim().min(2),
    account_name: z.string().trim().min(2),
    address: z.string().trim().min(3),
    city: z.string().trim().min(2),
    lga: z.string().trim().min(2),
    state_of_residence: z.string().trim().min(2),
    geo_political_zone: z.enum(GEO_POLITICAL_ZONES), consent: z.literal(true), ...pinField
  }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin: _pin, ...values } = body;
  const result = await submitBvnLicense({ userId: req.user!.id, values, idempotencyKey: idempotencyKeyFrom(req) });
  res.json({ status: true, data: result });
});

verificationRoutes.get('/bvn/license-onboarding/history', async (req, res) => {
  // A manual onboarding request may sit PENDING for days while an admin
  // processes it - unlike GET /history above, this deliberately does NOT
  // filter to status: SUCCESS only, so a customer can see (and download the
  // submission PDF for) a request that's still in progress, not just
  // completed ones. Same reasoning as listServiceTickets() in
  // verification.service.ts, just for the BVN_LICENSE_ONBOARDING
  // transaction type specifically, which that helper doesn't cover.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.transaction.findMany({
    where: {
      userId: req.user!.id,
      type: TransactionType.BVN_LICENSE_ONBOARDING,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: 'desc' }, take: 20
  });
  res.json({ status: true, data: rows.map((tx) => {
    const metadata = tx.metadata as Record<string, unknown> | null;
    return {
      reference: tx.reference,
      tracking_id: metadata?.tracking_id ?? null,
      status: tx.status.toLowerCase(),
      amount: Number(tx.amountKobo) / 100,
      pdf_base64: typeof metadata?.pdf_base64 === 'string' ? metadata.pdf_base64 : null,
      created_at: tx.createdAt.toISOString()
    };
  }) });
});

// A customer can retrieve a completed verification result for seven days.
// Async requests are intentionally absent while PENDING: their window begins
// when the transaction becomes SUCCESS, using updatedAt as the completion time.
verificationRoutes.get('/history', async (req, res) => {
  const service = z.string().trim().min(1).max(60).parse(req.query.service);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: req.user!.id,
      status: TransactionStatus.SUCCESS,
      updatedAt: { gte: since },
      type: {
        in: [
          TransactionType.NIN_VERIFICATION,
          TransactionType.BVN_VERIFICATION,
          TransactionType.IDENTITY_SERVICE_REQUEST
        ]
      }
    },
    orderBy: { updatedAt: 'desc' },
    take: 50
  });

  const data = transactions
    .filter((transaction) => {
      const metadata = transaction.metadata as Record<string, unknown> | null;
      return metadata?.service === service;
    })
    .slice(0, 10)
    .map((transaction) => {
      const metadata = transaction.metadata as Record<string, unknown> | null;
      const pii = decryptTransactionPII(metadata);
      // Older successful Techhub responses stored the provider payload under
      // `user_data`, including its own `pdf_base64`.  Read that nested shape
      // too, so an already-paid slip can be recovered without another call.
      const userData = pii?.user_data as Record<string, unknown> | undefined;
      const pdfBase64 =
        typeof pii?.pdf_base64 === 'string' && pii.pdf_base64.trim().length > 0
          ? pii.pdf_base64
          : typeof userData?.pdf_base64 === 'string' && userData.pdf_base64.trim().length > 0
            ? userData.pdf_base64
            : null;
      const pdfUrl =
        typeof pii?.pdf_url === 'string' && pii.pdf_url.trim().length > 0
          ? pii.pdf_url
          : typeof userData?.pdf_url === 'string' && userData.pdf_url.trim().length > 0
            ? userData.pdf_url
            : typeof userData?.slip_url === 'string' && userData.slip_url.trim().length > 0
              ? userData.slip_url
              : null;
      return {
        reference: transaction.reference,
        status: transaction.status.toLowerCase(),
        created_at: transaction.updatedAt.toISOString(),
        // Do not return identity details here. The PDF itself is the
        // retrievable document and the rest remains sealed in storage.
        pdf_base64: pdfBase64,
        pdf_url: pdfUrl,
        ticket_id: typeof metadata?.ticket_id === 'string' ? metadata.ticket_id : null
      };
    });

  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

// ── Slip lookups (synchronous) ────────────────────────────────────

verificationRoutes.post('/nin/by-nin', async (req, res) => {
  const body = z.object({ nin: z.string().trim().length(11), tier: ninSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByNin({
    userId: req.user!.id,
    nin: body.nin,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/nin/by-phone', async (req, res) => {
  const body = z.object({ phone: z.string().trim().length(11), tier: ninPhoneSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByPhone({
    userId: req.user!.id,
    phone: body.phone,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/nin/by-demographic', async (req, res) => {
  const body = z
    .object({
      firstname: z.string().trim().min(1),
      lastname: z.string().trim().min(1),
      dob: z.string().trim().min(1),
      gender: z.enum(['MALE', 'FEMALE']).optional(),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseNinByDemographic({
    userId: req.user!.id,
    firstname: body.firstname,
    lastname: body.lastname,
    dob: body.dob,
    gender: body.gender,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

verificationRoutes.post('/bvn/slip', async (req, res) => {
  const body = z.object({ bvn: z.string().trim().length(11), tier: bvnSlipTier, ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await purchaseBvnSlip({
    userId: req.user!.id,
    bvn: body.bvn,
    tier: body.tier,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json(slipResponse(result));
});

// ── Async services (submit + poll) ────────────────────────────────

verificationRoutes.post('/delinking', async (req, res) => {
  const body = z.object({ nin: z.string().trim().length(11), email: z.string().trim().email(), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitDelinking({
    userId: req.user!.id,
    nin: body.nin,
    email: body.email,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/delinking/:ticketId', async (req, res) => {
  const result = await checkDelinkingStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/nin-validation', async (req, res) => {
  const body = z
    .object({ nin: z.string().trim().length(11), validation_type: ninValidationType.optional(), ...pinField })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitNinValidation({
    userId: req.user!.id,
    nin: body.nin,
    validationType: body.validation_type,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/nin-validation/:ticketId', async (req, res) => {
  const result = await checkNinValidationStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/personalization', async (req, res) => {
  const body = z.object({ tracking_id: z.string().trim().min(1).max(50), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitPersonalization({
    userId: req.user!.id,
    trackingId: body.tracking_id,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/personalization/:ticketId', async (req, res) => {
  const result = await checkPersonalizationStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

// ── Ticket tracking table (Personalization, BVN Retrieval, IPE, Validation) ──
// See listServiceTickets in verification.service.ts for why this is separate
// from GET /history: it includes PENDING requests, not just SUCCESS ones.
verificationRoutes.get('/tickets', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const service = z.string().trim().min(1).max(60).parse(req.query.service);
  const data = await listServiceTickets(req.user!.id, service);
  res.json({ status: true, data });
});

verificationRoutes.post('/bvn-retrieval', async (req, res) => {
  const body = z
    .object({
      first_name: z.string().trim().min(1),
      last_name: z.string().trim().min(1),
      phone_number: z.string().trim().length(11),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitBvnRetrieval({
    userId: req.user!.id,
    firstName: body.first_name,
    lastName: body.last_name,
    phoneNumber: body.phone_number,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/bvn-retrieval/:ticketId', async (req, res) => {
  const result = await checkBvnRetrievalStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

verificationRoutes.post('/ipe-clearance', async (req, res) => {
  const body = z.object({ tracking_id: z.string().trim().min(1).max(20), ...pinField }).parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const result = await submitIpeClearance({
    userId: req.user!.id,
    trackingId: body.tracking_id,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, ticket_id: result.ticketId, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/ipe-clearance/:ticketId', async (req, res) => {
  const result = await checkIpeClearanceStatus({ userId: req.user!.id, ticketId: req.params.ticketId });
  res.json({ status: true, data: { ticket_id: result.ticketId, status: result.status, response: result.response } });
});

// ── CAC Services (manual — no provider API) ────────────────────────

verificationRoutes.get('/cac/prices', async (_req, res) => {
  const prices = await listCacPrices();
  res.json({ status: true, data: prices });
});

verificationRoutes.post('/cac', async (req, res) => {
  const body = z
    .object({
      cac_type: z.enum(CAC_TYPES),
      proposed_name_1: z.string().trim().min(2).max(200),
      proposed_name_2: z.string().trim().max(200).optional(),
      business_nature: z.string().trim().min(2).max(300),
      business_address: z.string().trim().min(3).max(300),
      proprietor_full_name: z.string().trim().min(2).max(200),
      proprietor_phone: z.string().trim().length(11),
      proprietor_email: z.string().trim().email(),
      proprietor_residential_address: z.string().trim().min(3).max(300),
      proprietor_date_of_birth: z.string().trim().min(8),
      proprietor_gender: z.enum(['Male', 'Female']),
      proprietor_nin: z.string().trim().length(11),
      ...pinField
    })
    .parse(req.body);
  await requirePinConfirmation(req.user!.id, body.pin);
  const { pin: _pin, cac_type, proposed_name_1, proposed_name_2, ...details } = body;
  const result = await submitCacRequest({
    userId: req.user!.id,
    type: cac_type as CacType,
    proposedName1: proposed_name_1,
    proposedName2: proposed_name_2,
    details,
    idempotencyKey: idempotencyKeyFrom(req)
  });
  res.json({ status: true, data: { reference: result.reference, balance_after: result.balanceAfter } });
});

verificationRoutes.get('/cac/history', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const data = await listCacHistory(req.user!.id);
  res.json({ status: true, data });
});
