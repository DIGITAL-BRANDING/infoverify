import { useMemo, useState, type FormEvent } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  SlipResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  money,
  type SlipResult,
} from '../../components/verification/shared';

// Screenshot calls these "Basic" and "Premium"; Techhub's own tiers (see
// TechhubBvnTier in techhub.service.ts) are 'standard' and 'premium' - so
// "Basic Slip" here maps onto the existing 'standard' tier rather than a
// new one.
const TIERS = ['standard', 'premium'] as const;
type Tier = (typeof TIERS)[number];
const TIER_LABEL: Record<Tier, string> = { standard: 'Basic Slip', premium: 'Premium Slip' };
const TIER_KEY: Record<Tier, string> = { standard: 'BVN_SLIP_STANDARD', premium: 'BVN_SLIP_PREMIUM' };

export default function BvnVerificationPage() {
  const { prices } = useVerificationPrices();
  const [tier, setTier] = useState<Tier>('standard');
  const [bvn, setBvn] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SlipResult | null>(null);

  const { history, loading: loadingHistory } = useVerificationHistory(TIER_KEY[tier]);
  const price = useMemo(() => prices[TIER_KEY[tier]], [tier, prices]);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{
        status: boolean;
        message: string;
        data?: { reference: string; user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string };
      }>('/verification/bvn/slip', { bvn, tier, pin });
      if (!result.status) throw new Error(result.message);
      setResult({ user_data: result.data?.user_data, pdf_base64: result.data?.pdf_base64, pdf_url: result.data?.pdf_url, reference: result.data?.reference ?? '' });
      setMessage(result.message || 'Done - your document is ready below.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <PageHeader title="BVN Verification" />

        <section className="mt-6 rounded-2xl border border-blue-400/50 bg-[#0b2f73] p-6">
          {!result ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Slip layout</StepLabel>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {TIERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`rounded-xl border p-4 text-center transition hover:-translate-y-0.5 ${
                      tier === t ? 'border-[#8b6914] bg-[#6b4f0b] text-white shadow-md' : 'border-parchment-line bg-cream text-ink hover:border-gold-500'
                    }`}
                  >
                    <span className="block font-semibold">{TIER_LABEL[t]}</span>
                    <span className={`mt-1 block text-xs font-bold ${tier === t ? 'text-[#ffe9a3]' : 'text-gold-700'}`}>{money(prices[TIER_KEY[t]])}</span>
                  </button>
                ))}
              </div>

              <StepLabel n={2}>Supply BVN Number</StepLabel>
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-body text-xs text-ink-600">
                <Terminal size={16} className="mt-0.5 shrink-0 text-gold-700" />
                <span>
                  <b>Need help?</b> Dial <span className="font-mono">*565*0#</span> from your registered phone number to retrieve your BVN instantly.
                </span>
              </div>
              <input
                required
                inputMode="numeric"
                maxLength={11}
                placeholder="BVN Number"
                className="mt-3 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                value={bvn}
                onChange={(e) => setBvn(e.target.value)}
              />
              <p className="mt-1 font-body text-xs text-ink-600">We'll never share your details with anyone else.</p>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(price)}</span>
                <button disabled={busy || !consent} className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
                </button>
              </div>
              {message && <p className="mt-3 rounded-lg bg-cream p-3 font-body text-sm text-ink-600">{message}</p>}
            </form>
          ) : (
            <SlipResultView
              result={result}
              message={message}
              onDone={() => {
                setResult(null);
                setMessage('');
                setBvn('');
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
