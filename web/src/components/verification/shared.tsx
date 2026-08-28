import { Download, Loader2, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// ── Shared types ────────────────────────────────────────────────
export type PriceRow = { service: string; unitPrice: number; isActive: boolean };
export type SlipResult = { user_data?: Record<string, unknown>; pdf_base64?: string; pdf_url?: string; reference: string };
export type AsyncResult = { ticket_id: string; reference: string };
export type TicketStatus = { ticket_id: string; status: 'pending' | 'success' | 'failed'; response: Record<string, unknown> | null };
export type VerificationHistory = {
  reference: string;
  status: string;
  created_at: string;
  pdf_base64: string | null;
  pdf_url: string | null;
  ticket_id: string | null;
};

export const money = (amount?: number) =>
  amount === undefined ? 'Price loading…' : `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// ── Prices ──────────────────────────────────────────────────────
export function useVerificationPrices() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get<{ data?: PriceRow[] } | PriceRow[]>('/verification/prices')
      .then((result) => {
        const rows = Array.isArray(result) ? result : (result.data ?? []);
        setPrices(Object.fromEntries(rows.map((row) => [row.service, Number(row.unitPrice)])));
      })
      .catch(() => setError('Unable to load current prices. Please refresh and try again.'));
  }, []);
  return { prices, error };
}

// ── Recent request history for one service key ─────────────────
export function useVerificationHistory(serviceKey: string) {
  const [history, setHistory] = useState<VerificationHistory[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!serviceKey) {
      setHistory([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .get<{ status: boolean; data: VerificationHistory[] }>(`/verification/history?service=${encodeURIComponent(serviceKey)}`)
      .then((result) => {
        if (active) setHistory(result.data ?? []);
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serviceKey]);
  return { history, loading };
}

// ── Polling for async (ticketed) services ───────────────────────
export function useTicketPolling(
  path: string,
  asyncResult: AsyncResult | null,
  ticketStatus: TicketStatus | null,
  setTicketStatus: (s: TicketStatus) => void
) {
  const [polling, setPolling] = useState(false);

  async function checkTicket(silent = false) {
    if (!asyncResult) return;
    if (!silent) setPolling(true);
    try {
      const result = await api.get<{ status: boolean; data: TicketStatus }>(`${path}/${asyncResult.ticket_id}`);
      setTicketStatus(result.data);
    } catch {
      // transient failures just mean "still can't tell yet" - the poll loop will retry
    } finally {
      if (!silent) setPolling(false);
    }
  }

  useEffect(() => {
    if (!asyncResult || ticketStatus?.status === 'success' || ticketStatus?.status === 'failed') return;
    void checkTicket(true);
    const id = setInterval(() => void checkTicket(true), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncResult, ticketStatus?.status]);

  return { polling, checkTicket };
}

// ── Slip Type card grid (used by NIN, BVN, IPE, Validation pages) ─
export function TierCardGrid<T extends string>({
  options,
  labels,
  value,
  onChange,
  priceFor,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  priceFor: (v: T) => number | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-xl border p-4 text-center transition hover:-translate-y-0.5 ${
            value === option ? 'border-[#8b6914] bg-[#6b4f0b] text-white shadow-md' : 'border-parchment-line bg-cream text-ink hover:border-gold-500'
          }`}
        >
          <span className="block text-sm font-semibold">{labels[option]}</span>
          <span className={`mt-1 block text-xs font-bold ${value === option ? 'text-[#ffe9a3]' : 'text-gold-700'}`}>{money(priceFor(option))}</span>
        </button>
      ))}
    </div>
  );
}

// ── Result views ──────────────────────────────────────────────────
export function SlipResultView({ result, message, onDone }: { result: SlipResult; message: string; onDone: () => void }) {
  const pdfBase64 = result.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
  const pdfHref = pdfBase64 ? `data:application/pdf;base64,${pdfBase64}` : result.pdf_url?.startsWith('https://') ? result.pdf_url : null;
  const dataEntries = result.user_data ? Object.entries(result.user_data).filter(([, v]) => v !== null && v !== undefined) : [];

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/5 px-4 py-3">
        <CheckCircle2 size={18} className="shrink-0 text-success-500" />
        <p className="font-body text-sm text-ink">{message}</p>
      </div>

      {dataEntries.length > 0 && (
        <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-cream p-4 sm:grid-cols-2">
          {dataEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-parchment-line py-1.5 text-sm">
              <span className="font-body capitalize text-ink-600">{key.replace(/_/g, ' ')}</span>
              <span className="font-body font-semibold text-ink">{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      {pdfHref && (
        <a
          href={pdfHref}
          download={`${result.reference || 'slip'}.pdf`}
          target={pdfBase64 ? undefined : '_blank'}
          rel={pdfBase64 ? undefined : 'noreferrer'}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 font-display font-semibold text-ink"
        >
          <Download size={16} /> Download PDF slip
        </a>
      )}

      {!pdfHref && (
        <p className="mt-4 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-body text-sm text-ink-600">
          The provider confirmed this request, but did not return a downloadable PDF. Keep the reference above and contact support; do not submit or pay for the request again.
        </p>
      )}

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-parchment-line py-2.5 font-body text-sm text-ink-600">
        Done
      </button>
    </div>
  );
}

export function AsyncResultView({
  ticket,
  status,
  polling,
  message,
  onRefresh,
  onDone,
}: {
  ticket: AsyncResult;
  status: TicketStatus | null;
  polling: boolean;
  message: string;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const state = status?.status ?? 'pending';
  const responseEntries = status?.response ? Object.entries(status.response).filter(([, v]) => v !== null && v !== undefined) : [];

  return (
    <div className="mt-6">
      {message && <p className="mb-4 rounded-lg bg-cream p-3 font-body text-sm text-ink-600">{message}</p>}

      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-4 ${
          state === 'success' ? 'border-success-500/30 bg-success-500/5' : state === 'failed' ? 'border-ember-500/30 bg-ember-500/5' : 'border-parchment-line bg-cream'
        }`}
      >
        {state === 'success' ? (
          <CheckCircle2 size={22} className="text-success-500" />
        ) : state === 'failed' ? (
          <XCircle size={22} className="text-ember-500" />
        ) : (
          <Clock size={22} className="text-gold-600" />
        )}
        <div>
          <p className="font-display font-semibold text-ink">{state === 'success' ? 'Approved' : state === 'failed' ? 'Rejected — refunded to your wallet' : 'Pending review'}</p>
          <p className="font-mono text-xs text-ink-600">Ticket: {ticket.ticket_id}</p>
        </div>
      </div>

      {responseEntries.length > 0 && (
        <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-cream p-4 sm:grid-cols-2">
          {responseEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-parchment-line py-1.5 text-sm">
              <span className="font-body capitalize text-ink-600">{key.replace(/_/g, ' ')}</span>
              <span className="font-body font-semibold text-ink">{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      {state === 'pending' && (
        <button onClick={onRefresh} disabled={polling} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-parchment-line py-2.5 font-body text-sm text-ink-600 disabled:opacity-60">
          {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Check again now
        </button>
      )}
      <p className="mt-2 text-center font-body text-[11px] text-ink-400">We're also checking automatically every few seconds.</p>

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-parchment-line py-2.5 font-body text-sm text-ink-600">
        Done
      </button>
    </div>
  );
}

export function VerificationHistoryView({ history, loading }: { history: VerificationHistory[]; loading: boolean }) {
  return (
    <section className="mt-8 border-t border-parchment-line pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">Recent requests</h3>
        <span className="font-body text-xs text-ink-600">Available for 7 days</span>
      </div>
      {loading ? (
        <p className="mt-3 font-body text-sm text-ink-600">Loading recent requests…</p>
      ) : history.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-parchment-line px-4 py-4 font-body text-sm text-ink-600">No request for this service in the last 7 days.</p>
      ) : (
        <div className="mt-3 divide-y divide-parchment-line overflow-hidden rounded-xl border border-parchment-line bg-cream">
          {history.map((entry) => {
            const base64 = entry.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
            const href = base64 ? `data:application/pdf;base64,${base64}` : entry.pdf_url?.startsWith('https://') ? entry.pdf_url : null;
            return (
              <div key={entry.reference} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-mono text-xs font-semibold text-ink">{entry.reference}</p>
                  <p className="mt-1 font-body text-xs text-ink-600">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
                {href ? (
                  <a href={href} download={`${entry.reference}.pdf`} target={base64 ? undefined : '_blank'} rel={base64 ? undefined : 'noreferrer'} className="flex items-center gap-2 rounded-lg bg-gold-500 px-3 py-2 font-body text-xs font-bold text-ink">
                    <Download size={14} /> Retrieve PDF
                  </a>
                ) : (
                  <span className="font-body text-xs font-semibold capitalize text-ink-600">{entry.status}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Page header, matching the SLT reference screenshots' numbered steps ──
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mt-5 rounded-2xl border border-blue-400/50 bg-[#0b2f73] p-6">
      <p className="font-body text-sm font-semibold text-gold-700">Identity services</p>
      <h1 className="mt-1 font-display text-3xl font-bold text-ink">{title}</h1>
      {subtitle && <p className="mt-2 font-body text-sm text-ink-600">{subtitle}</p>}
    </header>
  );
}

export function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-2 border-b border-parchment-line pb-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500 font-body text-xs font-bold text-ink">{n}</span>
      <h3 className="font-display text-sm font-bold text-ink">{children}</h3>
    </div>
  );
}

export function ConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-5 flex items-start gap-2 font-body text-xs text-ink-600">
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-parchment-line" />
      By checking this box, you agree that the owner of the ID has granted you consent to verify his/her identity.
    </label>
  );
}
