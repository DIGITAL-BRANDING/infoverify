import PDFDocument from 'pdfkit';
import { TransactionType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { sealPII, openPII } from '../lib/pii.js';
import { debitWallet } from './wallet.service.js';
export const GEO_POLITICAL_ZONES = ['North Central','North East','North West','South East','South South','South West'] as const;
export type BvnLicenseInput = Record<string, string | boolean> & { geo_political_zone: typeof GEO_POLITICAL_ZONES[number]; consent: boolean };
export function createBvnLicenseTrackingId() { return `MDL-BVN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; }
async function renderPdf(values:BvnLicenseInput, trackingId:string) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 }); const chunks:Buffer[]=[];
  doc.on('data',(c:Buffer)=>chunks.push(c));
  const done = new Promise<string>((resolve,reject)=>{ doc.on('end',()=>resolve(Buffer.concat(chunks).toString('base64'))); doc.on('error',reject); });
  doc.fontSize(20).fillColor('#111827').text('MAJOR DATA-LINK', {align:'center'}); doc.moveDown(.4);
  doc.fontSize(15).text('BVN License Onboarding Request', {align:'center'}); doc.moveDown();
  doc.fontSize(10).text(`Tracking ID: ${trackingId}`); doc.text(`Submitted: ${new Date().toISOString()}`); doc.moveDown();
  for (const [key,value] of Object.entries(values)) { if (key==='consent') continue; doc.fontSize(10).fillColor('#374151').text(`${key.replaceAll('_',' ').toUpperCase()}: ${String(value)}`); doc.moveDown(.25); }
  doc.moveDown(); doc.fontSize(9).fillColor('#6b7280').text('Submission record for manual processing.'); doc.end(); return done;
}
export async function submitBvnLicense(params:{userId:string;values:BvnLicenseInput;idempotencyKey?:string}) {
  const trackingId=createBvnLicenseTrackingId();
  const debit=await debitWallet({userId:params.userId,amount:10000,type:TransactionType.BVN_LICENSE_ONBOARDING,description:'BVN License Onboarding',metadata:{service:'BVN_LICENSE_ONBOARDING',tracking_id:trackingId,pii:sealPII(params.values)} as Prisma.InputJsonValue,idempotencyKey:params.idempotencyKey});
  if (!debit.reused) { const pdf_base64=await renderPdf(params.values,trackingId); const tx=await prisma.transaction.findUnique({where:{id:debit.transaction.id}}); if(tx) await prisma.transaction.update({where:{id:tx.id},data:{metadata:{service:'BVN_LICENSE_ONBOARDING',tracking_id:trackingId,pdf_base64,pii:sealPII(params.values)} as Prisma.InputJsonValue}}); }
  const existing=(debit.transaction?.metadata as Record<string,unknown>|null)?.tracking_id;
  return {trackingId: (existing as string|undefined) ?? trackingId,reference:debit.reference,balanceAfter:debit.balanceAfter};
}
export function decryptBvnLicensePII(t:{metadata:unknown}) { return openPII<Record<string,unknown>>((t.metadata as Record<string,unknown>|null)?.pii); }
