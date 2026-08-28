import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  AsyncResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  useTicketPolling,
  money,
  type AsyncResult,
  type TicketStatus,
} from '../../components/verification/shared';

// Only the first service type is wired to Techhub today (submitIpeClearance
// only takes a tracking_id — see verification.routes.ts POST
// /ipe-clearance). The other three cards from the reference design are
// shown for parity but disabled until pricing/logic for them is added
// server-side (each would need its own priced service key, the way
// NIN_VALIDATION_* was split out per validation_type).
const SERVICE_TYPES = [
  { id: 'enrollment', label: 'NIN enrollment for tracking ID', note: '(Normal IPE only)', enabled: true },
  { id: 'processing_error', label: 'InProcessing Error', note: '(Normal IPE)', enabled: false },
  { id: 'invalid_tracking', label: 'Invalid Tracking ID', note: '(Normal IPE)', enabled: false },
  { id: 'still_processing', label: 'Still Being Processed', note: '(Normal IPE)', enabled: false },
] as const;

const SLIP_TYPES = ['no-slip', 'regular', 'standard', 'premium'] as const;
type SlipType = (typeof SLIP_TYPES)[number];
const SLIP_LABEL: Record<SlipType, string> = { 'no-slip': 'No Slip', regular: 'Regular Slip', standard: 'Standard Slip', premium: 'Premium Slip' };

export default function IpeClearancePage() {
  const { prices } = useVerificationPrices();
  const [slipType, setSlipType] = useState<SlipType>('no-slip');
  const [trackingId, setTrackingId] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [asyncResult, setAsyncResult] = useState<AsyncResult | null>(null);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | null>(null);

  const price = prices['IPE_CLEARANCE'];
  const { history, loading: loadingHistory } = useVerificationHistory('IPE_CLEARANCE');
  const { polling, checkTicket } = useTicketPolling('/verification/ipe-clearance', asyncResult, ticketStatus, setTicketStatus);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message: string; data?: { reference: string; ticket_id?: string } }>('/verification/ipe-clearance', {
        tracking_id: trackingId,
        pin,
      });
      if (!result.status) throw new Error(result.message);
      if (!result.data?.ticket_id) throw new Error('No ticket was returned - please contact support.');
      setAsyncResult({ ticket_id: result.data.ticket_id, reference: result.data.reference });
      setMessage("Request submitted. We'll check its status below - this is usually reviewed within a few minutes.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="IPE Clearance (Instant)" />

        <section className="mt-6 rounded-2xl border border-blue-400/50 bg-[#0b2f73] p-6">
          {!asyncResult ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Service Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SERVICE_TYPES.map((s) => (
                  <div
                    key={s.id}
                    className={`relative rounded-xl border p-4 text-center ${
                      s.enabled ? 'border-[#8b6914] bg-[#6b4f0b] text-white shadow-md' : 'cursor-not-allowed border-parchment-line bg-cream text-ink-400 opacity-60'
                    }`}
                  >
                    {!s.enabled && <Lock size={12} className="absolute right-2 top-2" />}
                    <span className="block text-xs font-semibold leading-tight">{s.label}</span>
                    <span className="mt-1 block text-[10px]">{s.note}</span>
                    <span className={`mt-1 block text-xs font-bold ${s.enabled ? 'text-[#ffe9a3]' : ''}`}>{s.enabled ? money(price) : 'Coming soon'}</span>
                  </div>
                ))}
              </div>

              <StepLabel n={2}>Slip Type</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SLIP_TYPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlipType(s)}
                    className={`rounded-xl border p-4 text-center transition hover:-translate-y-0.5 ${
                      slipType === s ? 'border-[#8b6914] bg-[#6b4f0b] text-white shadow-md' : 'border-parchment-line bg-cream text-ink hover:border-gold-500'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{SLIP_LABEL[s]}</span>
                    <span className={`mt-1 block text-xs font-bold ${slipType === s ? 'text-[#ffe9a3]' : 'text-gold-700'}`}>{s === 'no-slip' ? money(0) : 'Coming soon'}</span>
                  </button>
                ))}
              </div>

              <StepLabel n={3}>Supply Tracking ID</StepLabel>
              <input
                required
                maxLength={15}
                placeholder="Tracking ID (15 characters)"
                className="mt-3 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
              />
              <p className="mt-1 font-body text-xs text-ink-600">Enter your 15-character alphanumeric Tracking ID (e.g., ABC123456789012)</p>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
                <button disabled={busy || !consent} className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Submit Verification'}
                </button>
              </div>
              {message && <p className="mt-3 rounded-lg bg-cream p-3 font-body text-sm text-ink-600">{message}</p>}
            </form>
          ) : (
            <AsyncResultView
              ticket={asyncResult}
              status={ticketStatus}
              polling={polling}
              message={message}
              onRefresh={() => checkTicket(false)}
              onDone={() => {
                setAsyncResult(null);
                setTicketStatus(null);
                setMessage('');
                setTrackingId('');
              }}
            />
          )}

          <VerificationHistoryView history={history} loading={loadingHistory} />
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
