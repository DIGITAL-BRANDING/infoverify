import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import { PageHeader, StepLabel, ConsentCheckbox, money, useVerificationPrices, FORM_SECTION_CLASSES, FORM_INPUT_CLASSES, FORM_HELP_CLASSES } from '../../components/verification/shared';

/**
 * "Phone Multiple" — enter a phone number, get back every NIN record linked
 * to it (flat ₦150), as opposed to /nin's "Phone No" method, which returns
 * one tiered slip.
 *
 * EXPECTED BACKEND CONTRACT (not yet implemented — wire this up against
 * whatever Techhub/other provider call actually does this lookup):
 *
 *   GET  /verification/prices               → must include a
 *        { service: 'NIN_PHONE_MULTIPLE', unitPrice, isActive } row for the
 *        price shown below to resolve (falls back to "Price loading…" until
 *        it does).
 *
 *   POST /verification/nin/phone-multiple
 *     body: { phone: string, pin: string }
 *     success response:
 *       { status: true, message: string,
 *         data: { reference: string, results: PhoneMultipleRecord[] } }
 *     failure response: { status: false, message: string }
 *     (results is an ARRAY, possibly empty if no NIN is linked to the
 *     number — the frontend treats an empty array as "no linked records"
 *     and does not treat that as an error)
 *
 *   GET  /verification/history?service=NIN_PHONE_MULTIPLE
 *     Same shape as every other service's history endpoint (see
 *     useVerificationHistory in shared.tsx) — reused as-is, no changes
 *     needed there once this service key exists.
 */
type PhoneMultipleRecord = {
  nin?: string;
  full_name?: string;
  [key: string]: unknown;
};

const SERVICE_KEY = 'NIN_PHONE_MULTIPLE';

export default function PhoneMultiplePage() {
  const { prices } = useVerificationPrices();
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<PhoneMultipleRecord[] | null>(null);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message: string; data?: { results?: PhoneMultipleRecord[] } }>('/verification/nin/phone-multiple', { phone, pin });
      if (!result.status) throw new Error(result.message);
      setResults(result.data?.results ?? []);
      setMessage(result.message || 'Done.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Phone Number Verification"
          subtitle="Enter your phone number to retrieve linked NIN information. If the phone number is connected to multiple NIN records, all matched results will be shown."
        />

        <section className={FORM_SECTION_CLASSES}>
          {results === null ? (
            <form onSubmit={prepare}>
              <StepLabel n={1}>Enter Phone Number</StepLabel>
              <input
                required
                inputMode="numeric"
                maxLength={11}
                placeholder="Enter Phone Number"
                className={`mt-3 ${FORM_INPUT_CLASSES}`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className={`mt-1 ${FORM_HELP_CLASSES}`}>Enter your 11-digit phone number starting with 0 (e.g., 08012345678). One phone number may return multiple linked NIN records.</p>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="rounded-full bg-gold-500/15 px-4 py-2 text-center font-body text-sm font-bold text-gold-700">Service cost: {money(prices[SERVICE_KEY])}</span>
                <button disabled={busy || !consent} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60 sm:w-auto">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : `Verify (${money(prices[SERVICE_KEY])})`}
                </button>
              </div>
              {message && <p className="mt-3 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}
            </form>
          ) : (
            <div>
              <p className="rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>

              {results.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-blue-200 px-4 py-6 text-center font-body text-sm text-[#0b2f73]/70">No NIN records are linked to this phone number.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {results.map((record, index) => (
                    <div key={String(record.nin ?? index)} className="rounded-xl bg-blue-50 p-4">
                      {Object.entries(record)
                        .filter(([, value]) => value !== null && value !== undefined)
                        .map(([key, value]) => (
                          <div key={key} className="flex justify-between border-b border-blue-100 py-1.5 text-sm last:border-0">
                            <span className="font-body capitalize text-[#0b2f73]/70">{key.replace(/_/g, ' ')}</span>
                            <span className="break-all text-right font-body font-semibold text-[#0b2f73]">{String(value)}</span>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setResults(null);
                  setMessage('');
                  setPhone('');
                }}
                className="mt-4 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]"
              >
                Done
              </button>
            </div>
          )}
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
