import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Loader2 } from 'lucide-react';
import AppShell from '../../components/AppShell';
import { api, ApiError } from '../../lib/api';
import { PinConfirmDialog } from '../../components/PinConfirmDialog';
import { PageHeader, money } from '../../components/verification/shared';

type CacType = 'sole' | 'partnership' | 'llc';
type CacPriceRow = { type: CacType; title: string; unitPrice: number; isActive: boolean };
type CacHistoryEntry = {
  reference: string;
  status: string;
  cac_type: string | null;
  proposed_name_1: string | null;
  proposed_name_2: string | null;
  amount: number;
  progress_notes: string | null;
  certificate_pdf_base64: string | null;
  created_at: string;
  updated_at: string;
};

const SERVICE_OPTIONS: { value: CacType; label: string }[] = [
  { value: 'sole', label: 'Business Name Sole Proprietorship' },
  { value: 'partnership', label: 'Business Name Partnership' },
  { value: 'llc', label: 'Limited Liability 1M Share' }
];

const STATUS_LABEL: Record<string, string> = { pending: 'Processing', success: 'Completed', failed: 'Rejected', reversed: 'Refunded' };

export default function CacServicesPage() {
  const [prices, setPrices] = useState<CacPriceRow[]>([]);
  const [service, setService] = useState<CacType | ''>('');
  const [name1, setName1] = useState('');
  const [name2, setName2] = useState('');
  const [consent, setConsent] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<CacHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const selectedPrice = useMemo(() => prices.find((p) => p.type === service)?.unitPrice, [prices, service]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const result = await api.get<{ status: boolean; data: CacHistoryEntry[] }>('/verification/cac/history');
      setHistory(result.data ?? []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    api
      .get<{ status: boolean; data: CacPriceRow[] }>('/verification/cac/prices')
      .then((result) => setPrices(result.data ?? []))
      .catch(() => setPrices([]));
    void loadHistory();
  }, []);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setShowPin(true);
  }

  async function submit(pin: string) {
    setShowPin(false);
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post<{ status: boolean; message?: string; data?: { reference: string } }>('/verification/cac', {
        cac_type: service,
        proposed_name_1: name1,
        proposed_name_2: name2 || undefined,
        pin
      });
      if (!result.status) throw new Error(result.message);
      setMessage(`Request submitted — reference ${result.data?.reference}. We'll register your business and update the status below.`);
      setService('');
      setName1('');
      setName2('');
      setConsent(false);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="CAC Services" subtitle="Business name and company registration. Requests are registered manually with CAC by our team — this isn't an instant service." />

        <section className="mt-6 rounded-2xl border border-blue-400/50 bg-[#0b2f73] p-6">
          <form onSubmit={prepare}>
            <label className="font-body text-sm font-medium text-ink-600">
              Choose Service
              <select
                required
                value={service}
                onChange={(e) => setService(e.target.value as CacType)}
                className="mt-1 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
              >
                <option value="">-- Select Service --</option>
                {SERVICE_OPTIONS.map((s) => {
                  const price = prices.find((p) => p.type === s.value);
                  return (
                    <option key={s.value} value={s.value} disabled={price ? !price.isActive : false}>
                      {s.label} ({money(price?.unitPrice)})
                    </option>
                  );
                })}
              </select>
              <span className="mt-1 block font-body text-xs text-ink-400">
                Registering an NGO, Club, Association, or a company with more than ₦1,000,000 share capital? These are quoted individually — contact support instead of using this form.
              </span>
            </label>

            {service && (
              <>
                <label className="mt-4 block font-body text-sm font-medium text-ink-600">
                  Proposed Name 1
                  <input
                    required
                    maxLength={200}
                    placeholder="e.g. Amana Traders"
                    className="mt-1 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                    value={name1}
                    onChange={(e) => setName1(e.target.value)}
                  />
                </label>
                <label className="mt-4 block font-body text-sm font-medium text-ink-600">
                  Proposed Name 2 <span className="font-normal text-ink-400">(backup, optional)</span>
                  <input
                    maxLength={200}
                    placeholder="e.g. Amana Global Ventures"
                    className="mt-1 w-full rounded-xl border border-parchment-line bg-cream p-3 text-ink outline-none focus:border-gold-500"
                    value={name2}
                    onChange={(e) => setName2(e.target.value)}
                  />
                </label>

                <label className="mt-5 flex items-start gap-2 font-body text-xs text-ink-600">
                  <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-parchment-line" />
                  I confirm these business name(s) and details are accurate, and I authorise this registration on my behalf.
                </label>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="rounded-full bg-gold-500/15 px-4 py-2 font-body text-sm font-bold text-gold-700">Service cost: {money(selectedPrice)}</span>
                  <button disabled={busy || !consent} className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-6 py-3 font-display font-semibold text-ink disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : 'Continue'}
                  </button>
                </div>
              </>
            )}
            {message && <p className="mt-3 rounded-lg bg-cream p-3 font-body text-sm text-ink-600">{message}</p>}
          </form>

          <div className="mt-8 border-t border-parchment-line pt-5">
            <h3 className="font-display text-base font-bold text-ink">Transactions</h3>

            {loadingHistory ? (
              <p className="mt-3 font-body text-sm text-ink-600">Loading…</p>
            ) : history.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-parchment-line px-4 py-4 text-center font-body text-sm text-ink-600">No transactions recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-parchment-line bg-cream">
                <table className="w-full text-left font-body text-xs">
                  <thead>
                    <tr className="border-b border-parchment-line text-ink-600">
                      {['Ref ID', 'Type', 'Proposed Nm 1', 'Proposed Nm 2', 'Amount', 'Status', 'Progress Notes', 'Date', ''].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.reference} className="border-b border-parchment-line last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono">{row.reference}</td>
                        <td className="whitespace-nowrap px-3 py-2">{SERVICE_OPTIONS.find((s) => s.value === row.cac_type)?.label ?? row.cac_type}</td>
                        <td className="px-3 py-2">{row.proposed_name_1 ?? '—'}</td>
                        <td className="px-3 py-2">{row.proposed_name_2 ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2">{money(row.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                              row.status === 'success' ? 'bg-success-500/15 text-success-600' : row.status === 'pending' ? 'bg-gold-500/15 text-gold-700' : 'bg-ember-500/15 text-ember-600'
                            }`}
                          >
                            {STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </td>
                        <td className="max-w-[200px] px-3 py-2 text-ink-600">{row.progress_notes ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-600">{new Date(row.created_at).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.certificate_pdf_base64 ? (
                            <a
                              href={`data:application/pdf;base64,${row.certificate_pdf_base64}`}
                              download={`${row.reference}.pdf`}
                              className="flex items-center gap-1 rounded-lg bg-gold-500 px-2 py-1.5 font-bold text-ink"
                            >
                              <Download size={12} /> PDF
                            </a>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <PinConfirmDialog open={showPin} onClose={() => setShowPin(false)} onVerified={submit} />
    </AppShell>
  );
}
