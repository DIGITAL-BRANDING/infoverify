import { getModelByName } from '@adminjs/prisma';
import type { ResourceWithOptions } from 'adminjs';
import { prisma } from '../../lib/prisma.js';
import { decryptTransactionPII } from '../../services/verification.service.js';
import { completeModification } from '../../services/nin-modification.service.js';
import { TransactionStatus } from '@prisma/client';
import { refundWallet } from '../../services/wallet.service.js';
import { logAdminAction } from '../audit.js';
import type { AdminSessionUser } from '../auth.js';

export const transactionResource: ResourceWithOptions = {
  resource: { model: getModelByName('Transaction'), client: prisma },
  options: {
    id: 'Transaction',
    navigation: { name: 'Ledger', icon: 'List' },
    listProperties: ['reference', 'type', 'status', 'amountKobo', 'provider', 'user', 'createdAt'],
    showProperties: [
      'id',
      'reference',
      'user',
      'type',
      'status',
      'amountKobo',
      'costKobo',
      'balanceBeforeKobo',
      'balanceAfterKobo',
      'provider',
      'providerRef',
      // NOT 'relatedTransactionId' (the raw scalar FK) - Prisma marks any
      // scalar field that backs a relation as isReadOnly:true in its DMMF
      // (same reason 'userId' isn't listed above either - only 'user' is),
      // and @adminjs/prisma's Resource.prepareProperties() silently drops
      // every isReadOnly field before building its properties map. Listing
      // the scalar name here made AdminJS throw "There is no property of
      // the name: relatedTransactionId" on every single page load. Using
      // the RELATION name instead is both the fix and strictly better UX -
      // it renders as a clickable link to the original/reversal transaction
      // instead of a bare opaque UUID string.
      'relatedTransaction',
      'idempotencyKey',
      'description',
      'metadata',
      'createdAt',
      'updatedAt'
    ],
    filterProperties: ['reference', 'user', 'type', 'status', 'createdAt'],
    actions: {
      // The ledger is append-only from the admin panel's perspective — corrections
      // happen via `reverse` (which creates its own audited record), never by editing
      // or deleting history directly.
      new: { isAccessible: false },
      edit: { isAccessible: false },
      delete: { isAccessible: false },
      reverse: {
        actionType: 'record',
        icon: 'RotateCcw',
        guard: "This credits the amount back to the user's wallet and marks the transaction REVERSED. Continue?",
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!admin || admin.role === 'SUPPORT') return false;
          const status = record?.params?.status;
          // A NIN Modification request sits PENDING (awaiting manual
          // processing on techhubltd.co, see nin-modification.service.ts)
          // until an admin either completes it or rejects it - unlike every
          // other transaction type, where PENDING means "still in flight,
          // don't touch it", so this is the one type reverse() also allows
          // from PENDING.
          if (status === 'PENDING') return ['NIN_MODIFICATION', 'BVN_LICENSE_ONBOARDING', 'CAC_SERVICE_REQUEST'].includes(record?.params?.type as string);
          return status === 'SUCCESS' || status === 'FAILED';
        },
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!record || !admin) {
            throw new Error('Missing record or admin context');
          }

          try {
            await refundWallet({
              transactionId: record.params.id as string,
              userId: record.params.user as string,
              initiatedByAdminId: admin.id
            });

            await logAdminAction({
              adminId: admin.id,
              action: 'REVERSE_TRANSACTION',
              targetType: 'Transaction',
              targetId: record.params.id as string,
              metadata: { reference: record.params.reference }
            });

            return {
              record: record.toJSON(currentAdmin),
              notice: { message: 'Transaction reversed and wallet credited.', type: 'success' }
            };
          } catch (error) {
            return {
              record: record.toJSON(currentAdmin),
              notice: {
                message: error instanceof Error ? error.message : 'Reversal failed',
                type: 'error'
              }
            };
          }
        }
      },
      // NIN/BVN/names/phone/generated slip PDFs are encrypted at rest under
      // metadata.pii (see src/lib/pii.ts) precisely so that browsing the
      // Transaction list - or a raw DB dump - never exposes them. This is
      // the one deliberate, narrow door back in: SUPER_ADMIN only, and every
      // single use is written to AdminAuditLog (who, when, which record) via
      // logAdminAction below, same as `reverse` above. It never persists the
      // decrypted value anywhere - it's read fresh from the DB, decrypted in
      // memory, shown once, and gone.
      viewPii: {
        actionType: 'record',
        icon: 'Eye',
        guard:
          'This decrypts and displays the NIN/BVN/name/phone/slip data on this transaction, and is logged to the audit trail. Continue?',
        isAccessible: ({ currentAdmin }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return admin?.role === 'SUPER_ADMIN';
        },
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!record || !admin) {
            throw new Error('Missing record or admin context');
          }

          const fresh = await prisma.transaction.findUnique({ where: { id: record.params.id as string } });
          const pii = fresh ? decryptTransactionPII(fresh.metadata) : null;

          await logAdminAction({
            adminId: admin.id,
            action: 'VIEW_TRANSACTION_PII',
            targetType: 'Transaction',
            targetId: record.params.id as string,
            metadata: { reference: record.params.reference }
          });

          return {
            record: record.toJSON(currentAdmin),
            notice: pii
              ? { message: `Decrypted: ${JSON.stringify(pii)}`, type: 'success' }
              : { message: 'No PII found on this transaction, or it failed to decrypt.', type: 'error' }
          };
        }
      },
      // Marks a manually-processed NIN Modification request done once the
      // admin has re-keyed it on techhubltd.co and it went through - no
      // wallet movement, the customer paid at submit time. Rejecting instead
      // uses the "reverse" action above (its guard was extended to allow
      // this from PENDING for NIN_MODIFICATION rows specifically).
      completeModification: {
        actionType: 'record',
        icon: 'CheckCircle',
        guard: 'Mark this NIN Modification request as completed? Only do this after it has actually gone through on techhubltd.co.',
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!admin || admin.role === 'SUPPORT') return false;
          return record?.params?.type === 'NIN_MODIFICATION' && record?.params?.status === 'PENDING';
        },
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          if (!record || !admin) {
            throw new Error('Missing record or admin context');
          }

          try {
            await completeModification({ transactionId: record.params.id as string });

            await logAdminAction({
              adminId: admin.id,
              action: 'COMPLETE_NIN_MODIFICATION',
              targetType: 'Transaction',
              targetId: record.params.id as string,
              metadata: { reference: record.params.reference }
            });

            return {
              record: record.toJSON(currentAdmin),
              notice: { message: 'Marked as completed.', type: 'success' }
            };
          } catch (error) {
            return {
              record: record.toJSON(currentAdmin),
              notice: {
                message: error instanceof Error ? error.message : 'Could not mark this as completed',
                type: 'error'
              }
            };
          }
        }
      },
      // Opens the generated submission PDF - same SUPER_ADMIN-only,
      // audit-logged posture as viewPii above (see src/admin/nin-modification.ts),
      // but streams the real PDF instead of dumping raw JSON into a notice.
      downloadModificationPdf: {
        actionType: 'record',
        icon: 'Download',
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return admin?.role === 'SUPER_ADMIN' && record?.params?.type === 'NIN_MODIFICATION';
        },
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          if (!record) {
            throw new Error('Missing record');
          }
          return {
            record: record.toJSON(currentAdmin),
            redirectUrl: `/admin/nin-modification/${record.params.id as string}/pdf`
          };
        }
      },
      completeBvnLicense: {
        actionType: 'record', icon: 'CheckCircle',
        guard: 'Mark this BVN License request as completed?',
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return !!admin && admin.role !== 'SUPPORT' && record?.params?.type === 'BVN_LICENSE_ONBOARDING' && record?.params?.status === 'PENDING';
        },
        handler: async (_request, _response, context) => {
          const { record, currentAdmin } = context; const admin = currentAdmin as unknown as AdminSessionUser;
          if (!record || !admin) throw new Error('Missing record or admin context');
          await prisma.transaction.update({ where: { id: record.params.id as string }, data: { status: TransactionStatus.SUCCESS } });
          await logAdminAction({ adminId: admin.id, action: 'COMPLETE_BVN_LICENSE', targetType: 'Transaction', targetId: record.params.id as string, metadata: { reference: record.params.reference } });
          return { record: record.toJSON(currentAdmin), notice: { message: 'BVN License request marked as completed.', type: 'success' } };
        }
      },
      downloadBvnLicensePdf: {
        actionType: 'record', icon: 'Download',
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return admin?.role === 'SUPER_ADMIN' && record?.params?.type === 'BVN_LICENSE_ONBOARDING';
        },
        handler: async (_request, _response, context) => {
          const { record, currentAdmin } = context; if (!record) throw new Error('Missing record');
          return { record: record.toJSON(currentAdmin), redirectUrl: `/admin/bvn-license/${record.params.id as string}/pdf` };
        }
      },
      // Opens the custom "manage" page (admin/cac.ts) where an admin can save
      // a progress note and/or upload the finished certificate PDF, which
      // marks the request SUCCESS. Unlike completeModification/
      // completeBvnLicense above, this needs a real form (a note + a file),
      // not a single confirm-guard click, hence the redirect to a dedicated
      // page instead of an inline handler.
      manageCacRequest: {
        actionType: 'record', icon: 'Edit',
        isAccessible: ({ currentAdmin, record }) => {
          const admin = currentAdmin as unknown as AdminSessionUser | undefined;
          return !!admin && admin.role !== 'SUPPORT' && record?.params?.type === 'CAC_SERVICE_REQUEST';
        },
        handler: async (_request, _response, context) => {
          const { record, currentAdmin } = context; if (!record) throw new Error('Missing record');
          return { record: record.toJSON(currentAdmin), redirectUrl: `/admin/cac/${record.params.id as string}/manage` };
        }
      }
    }
  }
};
