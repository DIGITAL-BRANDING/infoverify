import { useMemo, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import {
  PageHeader,
  StepLabel,
  ConsentCheckbox,
  TierCardGrid,
  SlipResultView,
  VerificationHistoryView,
  useVerificationPrices,
  useVerificationHistory,
  money,
  type SlipResult,
} from '../../components/verification/shared';

type Method = 'nin' | 'phone';
const NIN_TIERS = ['information', 'regular', 'standard', 'premium', 'vnin'] as const;
const PHONE_TIERS = ['regular', 'standard', 'premium'] as const;
type NinTier = (typeof NIN_TIERS)[number];
type PhoneTier = (typeof PHONE_TIERS)[number];

const NIN_TIER_LABELS: Record<NinTier, string> = {
  information: 'Information Slip',
  regular: 'Regular Slip',
  standard: 'Standard Slip',
  premium: 'Premium Slip',
  vnin: 'V-NIN Slip',
};
const PHONE_TIER_LABELS: Record<PhoneTier, string> = {
  regular: 'Regular Slip',
  standard: 'Standard Slip',
  premium: 'Premium Slip',
};

// "Information Slip" isn't wired up on Techhub's side yet (see
// maria_backend/src/services/techhub.service.ts — TechhubSlipTier only
// has premium/standard/regular/vnin). It renders here so the page matches
// the reference design, but stays disabled and un-priced until the backend
// adds that tier.
const NIN_KEY: Record<Exclude<NinTier, 'information'>, string> = {
  regular: 'NIN_SLIP_REGULAR',
  standard: 'NIN_SLIP_STANDARD',
  premium: 'NIN_SLIP_PREMIUM',
  vnin: 'NIN_SLIP_VNIN',
};
const PHONE_KEY: Record<PhoneTier, string> = {
  regular: 'NIN_PHONE_SLIP_REGULAR',
  standard: 'NIN_PHONE_SLIP_STANDARD',
  premium: 'NIN_PHONE_SLIP_PREMIUM',
};

export default function NinPhoneVerificationPage() {
  const { prices } = useVerificationPrices();
  const [method, setMethod] = useState<Method>('nin');
  const [idValue, setIdValue] = useState('');
  const [ninTier, setNinTier] = useState<NinTier>('premium');
  const [phoneTier, setPhoneTier] = useState<PhoneTier>('premium');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SlipResult | null>(null);

  const serviceKey = method === 'nin' ? (ninTier === 'information' ? '' : NIN_KEY[ninTier]) : PHONE_KEY[phoneTier];
  const { history, loading: loadingHistory } = useVerificationHistory(serviceKey);
  const price = useMemo(() => (serviceKey ? prices[serviceKey] : undefined), [serviceKey, prices]);

  function prepare(event: FormEvent) {
    event.preventDefault();
    if (method === 'nin' && ninTier === 'information') {
      setMessage('The Information Slip is not available yet — please pick another slip type.');
      return;
    }
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const path = method === 'nin' ? '/verification/nin/by-nin' : '/verification/nin/by-phone';
      const body = method === 'nin' ? { nin: idValue, tier: ninTier, pin } : { phone: idValue, tier: phoneTier, pin };
      const result = await api.post<{
        status: boolean;
        message: string;
        data?: { reference: string; user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string };
      }>(path, body);
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
      <div className="mx-auto max-w-4xl">
        <PageHeader title="NIN_Phone Verification" subtitle="Verify a NIN directly, or look one up by its registered phone number." />

        <section className="mt-6 rounded-2xl border border-blue-400/50 bg-[#0b2f73] p-6">
          {!result ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Choose Verification Method</StepLabel>
              <div className="mt-3 flex gap-6 font-body text-sm font-medium text-ink">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={method === 'nin'} onChange={() => { setMethod('nin'); setIdValue(''); setMessage(''); }} /> NIN ID
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={method === 'phone'} onChange={() => { setMethod('phone'); setIdValue(''); setMessage(''); }} /> Phone No
                </label>
              </div>

              <StepLabel n={2}>Supply ID Number</StepLabel>
              <input
                required
                inputMode="numeric"
                maxLength={11}
                placeholder={method === 'nin' ? 'Enter NIN' : 'Enter Phone Number'}
                className="mt-3 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                value={idValue}
                onChange={(e) => setIdValue(e.target.value)}
              />
              <p className="mt-1 font-body text-xs text-ink-600">
                {method === 'nin' ? 'Enter your 11-digit NIN (e.g., 12345678901)' : 'Enter your 11-digit phone number starting with 0 (e.g., 08012345678)'}
              </p>

              <StepLabel n={3}>Select Your Preferred Slip Type</StepLabel>
              <div className="mt-3">
                {method === 'nin' ? (
                  <TierCardGrid
                    options={NIN_TIERS}
                    labels={NIN_TIER_LABELS}
                    value={ninTier}
                    onChange={setNinTier}
                    priceFor={(t) => (t === 'information' ? undefined : prices[NIN_KEY[t]])}
                  />
                ) : (
                  <TierCardGrid options={PHONE_TIERS} labels={PHONE_TIER_LABELS} value={phoneTier} onChange={setPhoneTier} priceFor={(t) => prices[PHONE_KEY[t]]} />
                )}
              </div>

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
                setIdValue('');
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
