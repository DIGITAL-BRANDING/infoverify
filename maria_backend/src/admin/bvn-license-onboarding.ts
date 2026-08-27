import type { Request, Router } from 'express';
import { TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decryptBvnLicensePII } from '../services/bvn-license-onboarding.service.js';
import { logAdminAction } from './audit.js';
export function registerBvnLicenseRoutes(router: Router) {
  router.get('/bvn-license/:transactionId/pdf', async (req: Request, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (admin.role !== 'SUPER_ADMIN') return res.status(403).send('Only a Super Admin can download this PDF.');
    const id = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
    const tx = await prisma.transaction.findUnique({ where: { id } });
    if (!tx || tx.type !== TransactionType.BVN_LICENSE_ONBOARDING) return res.status(404).send('BVN License request not found.');
    const pii = decryptBvnLicensePII(tx);
    if (!pii?.pdf_base64) return res.status(404).send('PDF not found.');
    await logAdminAction({ adminId: admin.id, action: 'VIEW_TRANSACTION_PII', targetType: 'Transaction', targetId: tx.id, metadata: { tracking_id: (tx.metadata as any)?.tracking_id } });
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${tx.reference}.pdf"`).send(Buffer.from(pii.pdf_base64 as string, 'base64'));
  });
}
