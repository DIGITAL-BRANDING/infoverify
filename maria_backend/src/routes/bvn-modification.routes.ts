import { Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pinField, requirePinConfirmation } from '../lib/require-pin.js';
import {
  BVN_MODIFICATION_CONFIG,
  BVN_MODIFICATION_TYPES,
  type BvnModificationField,
  type BvnModificationType,
  listBvnModificationHistory,
  listBvnModificationPrices,
  submitBvnModificationRequest
} from '../services/bvn-modification.service.js';

export const bvnModificationRoutes = Router();

bvnModificationRoutes.use(requireAuth);

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  const header = req.header('Idempotency-Key');
  return header && header.trim().length > 0 ? header.trim() : undefined;
}

function zodFor(field: BvnModificationField): ZodTypeAny {
  let schema: ZodTypeAny;
  switch (field.input) {
    case 'bvn':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits');
      break;
    case 'phone':
      schema = z.string().trim().length(11, 'Must be exactly 11 digits').regex(/^0\d{10}$/, 'Must start with 0');
      break;
    case 'email':
      schema = z.string().trim().email();
      break;
    case 'date':
      schema = z.string().trim().min(1);
      break;
    default:
      schema = z.string().trim().min(1).max(200);
  }
  return field.required ? schema : schema.optional().or(z.literal(''));
}

/** Builds { bvn: z..., account_number: z..., ... } straight from the type's field config, so a new field only ever needs updating in bvn-modification.service.ts. */
function schemaFor(type: BvnModificationType) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of BVN_MODIFICATION_CONFIG[type].fields) {
    shape[field.key] = zodFor(field);
  }
  return z.object({ ...shape, ...pinField });
}

// ── Config + prices ─────────────────────────────────────────────

bvnModificationRoutes.get('/types', (_req, res) => {
  const data = BVN_MODIFICATION_TYPES.map((type) => ({
    id: type,
    title: BVN_MODIFICATION_CONFIG[type].title,
    fields: BVN_MODIFICATION_CONFIG[type].fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      input: field.input
    }))
  }));
  res.json({ status: true, data });
});

bvnModificationRoutes.get('/prices', async (_req, res) => {
  const prices = await listBvnModificationPrices();
  res.json({ status: true, data: prices });
});

// ── History ──────────────────────────────────────────────────────

bvnModificationRoutes.get('/history', async (req, res) => {
  const type = req.query.type ? z.enum(BVN_MODIFICATION_TYPES).parse(req.query.type) : undefined;
  const data = await listBvnModificationHistory({ userId: req.user!.id, type });
  res.set('Cache-Control', 'no-store');
  res.json({ status: true, data });
});

// ── Submit (one route per type, each validated against that type's own
// field config) ─────────────────────────────────────────────────────────

for (const type of BVN_MODIFICATION_TYPES) {
  bvnModificationRoutes.post(`/${type}/submit`, async (req, res) => {
    const body = schemaFor(type).parse(req.body);
    await requirePinConfirmation(req.user!.id, body.pin);
    const { pin, ...values } = body;
    void pin;
    const result = await submitBvnModificationRequest({
      userId: req.user!.id,
      type,
      values,
      idempotencyKey: idempotencyKeyFrom(req)
    });
    res.json({
      status: true,
      message: 'Your request has been submitted and is being reviewed. You will be notified once it is complete.',
      data: { reference: result.reference, balance_after: result.balanceAfter }
    });
  });
}
