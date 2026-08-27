import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain']);

function config() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase Storage is not configured');
  return { url: env.SUPABASE_URL.replace(/\/$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
}

export async function createUserDelivery(input: { userId: string; adminId: string; title: string; description?: string; fileName: string; mimeType: string; base64: string; reference?: string }) {
  const c = config();
  if (!allowed.has(input.mimeType)) throw new Error('Unsupported delivery file type');
  const bytes = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('File must be between 1 byte and 10MB');
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${input.userId}/${crypto.randomUUID()}-${safeName}`;
  const upload = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, 'Content-Type': input.mimeType, 'x-upsert': 'false' }, body: bytes });
  if (!upload.ok) throw new Error(`Supabase upload failed (${upload.status})`);
  const delivery = await prisma.userDelivery.create({ data: { userId: input.userId, createdByAdminId: input.adminId, title: input.title, description: input.description, fileName: safeName, mimeType: input.mimeType, filePath: path, fileSize: bytes.length, reference: input.reference } });
  return delivery;
}

export async function listUserDeliveries(userId: string) {
  return prisma.userDelivery.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
}

export async function signedDeliveryUrl(userId: string, id: string) {
  const c = config();
  const row = await prisma.userDelivery.findFirst({ where: { id, userId } });
  if (!row) return null;
  const response = await fetch(`${c.url}/storage/v1/object/sign/${c.bucket}/${row.filePath}`, { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 }) });
  if (!response.ok) throw new Error(`Supabase signing failed (${response.status})`);
  const body = await response.json() as { signedURL?: string };
  return { row, url: body.signedURL ? `${c.url}/storage/v1${body.signedURL}` : null };
}
