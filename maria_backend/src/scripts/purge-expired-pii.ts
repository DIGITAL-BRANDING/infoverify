import 'dotenv/config';
import { TransactionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Deletes the encrypted NIN/BVN/name/phone/slip-PDF data (metadata.pii) off
 * Techhub-provider transactions once it's past its retention window -
 * everything else about the transaction (amount, status, reference, dates)
 * is left untouched, since that's the accounting record and needs to stay
 * for the ledger regardless of how old it is.
 *
 * This is data-minimization, layered on top of the field-level encryption
 * in src/lib/pii.ts: encryption protects the data while it's retained,
 * this makes sure it isn't retained forever "just in case". Run on a
 * schedule (Railway Cron Job / any external scheduler calling
 * `npm run purge:pii`, or a plain `cron` entry on your own box) - it does
 * nothing destructive if run more than once, since already-purged rows are
 * simply skipped.
 *
 * PII_RETENTION_DAYS controls the window (default 90). Only touches
 * SUCCESS/FAILED transactions - a still-PENDING async ticket needs its PII
 * to eventually be checked/resolved, so it's never a purge candidate.
 */
async function main() {
  const retentionDays = Number(process.env.PII_RETENTION_DAYS ?? 90);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`Invalid PII_RETENTION_DAYS: ${process.env.PII_RETENTION_DAYS}`);
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.transaction.findMany({
    where: {
      provider: 'techhub',
      status: { in: [TransactionStatus.SUCCESS, TransactionStatus.FAILED] },
      createdAt: { lt: cutoff }
    },
    select: { id: true, metadata: true, createdAt: true }
  });

  let purged = 0;
  let skipped = 0;

  for (const row of candidates) {
    const metadata = row.metadata as Record<string, unknown> | null;
    if (!metadata || !metadata.pii || (metadata.pii as { _purged?: boolean })._purged) {
      skipped += 1;
      continue;
    }

    await prisma.transaction.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...metadata,
          pii: { _purged: true, purgedAt: new Date().toISOString() }
        }
      }
    });
    purged += 1;
  }

  console.log(
    `[purge-expired-pii] retention=${retentionDays}d cutoff=${cutoff.toISOString()} ` +
      `purged=${purged} skipped=${skipped} (of ${candidates.length} candidates)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[purge-expired-pii] failed:', error);
    process.exit(1);
  });
