import type { Request, Router } from 'express';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

/**
 * Powers the "unresolved requests" popup shown on the admin dashboard
 * (components/dashboard.tsx) - a quick summary of every manually-processed
 * request type (CAC, BVN License, BVN Modification, NIN Modification,
 * Birth Attestation, Newspaper Publication) still sitting PENDING, plus how
 * many of each arrived in the last 24 hours, so an admin logging in
 * immediately sees what's backed up without clicking through every
 * "Requests" tile individually.
 *
 * This is registered on the SAME router AdminJS itself uses (see
 * setup.ts), which shares AdminJS's own session/cookie
 * (`imam_admin_sid`) - NOT routes/admin-api.routes.ts, which requires a
 * customer-app Bearer token that a request originating from inside the
 * AdminJS panel's own React components never has. Same pattern as
 * admin/cac.ts's manage page.
 */
const PENDING_SUMMARY_TYPES: { type: TransactionType; label: string }[] = [
  { type: TransactionType.CAC_SERVICE_REQUEST, label: 'CAC Registration' },
  { type: TransactionType.BVN_LICENSE_ONBOARDING, label: 'BVN License Enrollment' },
  { type: TransactionType.BVN_MODIFICATION, label: 'BVN Modification' },
  { type: TransactionType.NIN_MODIFICATION, label: 'NIN Modification' },
  { type: TransactionType.BIRTH_ATTESTATION, label: 'Birth Attestation' },
  { type: TransactionType.NEWSPAPER_PUBLICATION, label: 'Newspaper Publication' }
];

export function registerPendingSummaryRoutes(router: Router) {
  router.get('/pending-summary', async (req: Request, res) => {
    if (!req.session?.adminUser) {
      return res.status(401).json({ status: false, message: 'Not signed in' });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await Promise.all(
      PENDING_SUMMARY_TYPES.map(async ({ type, label }) => {
        try {
          const [pending, newLast24h] = await Promise.all([
            prisma.transaction.count({ where: { type, status: TransactionStatus.PENDING } }),
            prisma.transaction.count({ where: { type, status: TransactionStatus.PENDING, createdAt: { gte: since24h } } })
          ]);
          return { type, label, pending, new_last_24h: newLast24h };
        } catch (error) {
          // Older production databases may not yet have the newest enum value.
          // Keep the admin dashboard alive; the migration can be applied later.
          console.warn(`[admin] pending summary unavailable for ${String(type)}`, error instanceof Error ? error.message : error);
          return { type, label, pending: 0, new_last_24h: 0 };
        }
      })
    );

    res.json({
      status: true,
      data: {
        total_pending: rows.reduce((sum, r) => sum + r.pending, 0),
        total_new_last_24h: rows.reduce((sum, r) => sum + r.new_last_24h, 0),
        by_type: rows
      }
    });
  });
}
