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

/**
 * Two-tone palette used across every split-out verification page:
 *   - "Tiles" (the intro banner + selectable option cards) are filled solid
 *     royal blue with white text, for high contrast against the blue.
 *   - "Forms" (the card holding the actual inputs) are white with royal
 *     blue text, so the blue reads as an accent, not a wash the labels
 *     disappear into.
 * Kept as exported class-string constants (rather than a Tailwind color
 * token) so every page and shared component stays visually consistent
 * without having to remember the exact hex each time.
 */
export const ROYAL_BLUE = '#0b2f73';
export const TILE_CLASSES =
  'rounded-xl border-2 border-transparent bg-[#0b2f73] p-3 text-center text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-110 sm:p-4';
export const TILE_SELECTED_CLASSES = 'border-gold-400 ring-2 ring-gold-400/50 shadow-lg';
export const FORM_SECTION_CLASSES = 'mt-6 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6';
export const FORM_INPUT_CLASSES =
  'w-full rounded-xl border border-blue-200 bg-white p-3 text-[#0b2f73] outline-none placeholder:text-blue-300 focus:border-[#0b2f73]';
export const FORM_LABEL_CLASSES = 'font-body text-sm font-medium text-[#0b2f73]';
export const FORM_HELP_CLASSES = 'font-body text-xs text-[#0b2f73]/70';

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
  iconFor,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  priceFor: (v: T) => number | undefined;
  /** Optional per-option preview icon (see SlipIcon) — shown above the label, matching the reference design's little slip images. */
  iconFor?: (v: T) => SlipIconVariant;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`${TILE_CLASSES} ${value === option ? TILE_SELECTED_CLASSES : ''}`}
        >
          {iconFor && (
            <div className="mb-2 flex justify-center rounded-lg bg-white/10 p-1.5">
              <SlipIcon variant={iconFor(option)} />
            </div>
          )}
          <span className="block text-xs font-semibold text-white sm:text-sm">{labels[option]}</span>
          <span className="mt-1 block text-xs font-bold text-gold-300">{money(priceFor(option))}</span>
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
        <p className="font-body text-sm text-[#0b2f73]">{message}</p>
      </div>

      {dataEntries.length > 0 && (
        <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-blue-50 p-4 sm:grid-cols-2">
          {dataEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-blue-100 py-1.5 text-sm">
              <span className="font-body capitalize text-[#0b2f73]/70">{key.replace(/_/g, ' ')}</span>
              <span className="break-all text-right font-body font-semibold text-[#0b2f73]">{String(value)}</span>
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
        <p className="mt-4 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 font-body text-sm text-[#0b2f73]/80">
          The provider confirmed this request, but did not return a downloadable PDF. Keep the reference above and contact support; do not submit or pay for the request again.
        </p>
      )}

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]">
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
      {message && <p className="mb-4 rounded-lg bg-blue-50 p-3 font-body text-sm text-[#0b2f73]">{message}</p>}

      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-4 ${
          state === 'success' ? 'border-success-500/30 bg-success-500/5' : state === 'failed' ? 'border-ember-500/30 bg-ember-500/5' : 'border-blue-100 bg-blue-50'
        }`}
      >
        {state === 'success' ? (
          <CheckCircle2 size={22} className="shrink-0 text-success-500" />
        ) : state === 'failed' ? (
          <XCircle size={22} className="shrink-0 text-ember-500" />
        ) : (
          <Clock size={22} className="shrink-0 text-gold-600" />
        )}
        <div>
          <p className="font-display font-semibold text-[#0b2f73]">{state === 'success' ? 'Approved' : state === 'failed' ? 'Rejected — refunded to your wallet' : 'Pending review'}</p>
          <p className="break-all font-mono text-xs text-[#0b2f73]/70">Ticket: {ticket.ticket_id}</p>
        </div>
      </div>

      {responseEntries.length > 0 && (
        <div className="mt-4 grid gap-x-6 gap-y-2 rounded-xl bg-blue-50 p-4 sm:grid-cols-2">
          {responseEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between border-b border-blue-100 py-1.5 text-sm">
              <span className="font-body capitalize text-[#0b2f73]/70">{key.replace(/_/g, ' ')}</span>
              <span className="break-all text-right font-body font-semibold text-[#0b2f73]">{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      {state === 'pending' && (
        <button onClick={onRefresh} disabled={polling} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73] disabled:opacity-60">
          {polling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Check again now
        </button>
      )}
      <p className="mt-2 text-center font-body text-[11px] text-[#0b2f73]/50">We're also checking automatically every few seconds.</p>

      <button onClick={onDone} className="mt-3 w-full rounded-xl border border-blue-200 py-2.5 font-body text-sm text-[#0b2f73]">
        Done
      </button>
    </div>
  );
}

export function VerificationHistoryView({ history, loading }: { history: VerificationHistory[]; loading: boolean }) {
  return (
    <section className="mt-8 border-t border-blue-100 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold text-[#0b2f73]">Recent requests</h3>
        <span className="font-body text-xs text-[#0b2f73]/70">Available for 7 days</span>
      </div>
      {loading ? (
        <p className="mt-3 font-body text-sm text-[#0b2f73]/70">Loading recent requests…</p>
      ) : history.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-blue-200 px-4 py-4 font-body text-sm text-[#0b2f73]/70">No request for this service in the last 7 days.</p>
      ) : (
        <div className="mt-3 divide-y divide-blue-100 overflow-hidden rounded-xl border border-blue-100 bg-blue-50">
          {history.map((entry) => {
            const base64 = entry.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
            const href = base64 ? `data:application/pdf;base64,${base64}` : entry.pdf_url?.startsWith('https://') ? entry.pdf_url : null;
            return (
              <div key={entry.reference} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-xs font-semibold text-[#0b2f73]">{entry.reference}</p>
                  <p className="mt-1 font-body text-xs text-[#0b2f73]/70">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
                {href ? (
                  <a href={href} download={`${entry.reference}.pdf`} target={base64 ? undefined : '_blank'} rel={base64 ? undefined : 'noreferrer'} className="flex shrink-0 items-center gap-2 rounded-lg bg-gold-500 px-3 py-2 font-body text-xs font-bold text-ink">
                    <Download size={14} /> Retrieve PDF
                  </a>
                ) : (
                  <span className="shrink-0 font-body text-xs font-semibold capitalize text-[#0b2f73]/70">{entry.status}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Page header (tile), matching the SLT reference screenshots ──────
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mt-5 rounded-2xl bg-[#0b2f73] p-4 sm:p-6">
      <p className="font-body text-xs font-semibold text-gold-300 sm:text-sm">Identity services</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 font-body text-sm text-blue-100">{subtitle}</p>}
    </header>
  );
}

export function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-2 border-b border-blue-100 pb-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500 font-body text-xs font-bold text-ink">{n}</span>
      <h3 className="font-display text-sm font-bold text-[#0b2f73]">{children}</h3>
    </div>
  );
}

export function ConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-5 flex items-start gap-2 font-body text-xs text-[#0b2f73]/80">
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-blue-300 text-[#0b2f73] focus:ring-[#0b2f73]" />
      By checking this box, you agree that the owner of the ID has granted you consent to verify his/her identity.
    </label>
  );
}

// ── Ticket tracking table (Personalization, BVN Retrieval, etc.) ────
// Unlike useVerificationHistory above (SUCCESS-only, 7-day window, backed
// by GET /verification/history), this is backed by GET /verification/tickets
// and includes every status - PENDING requests are the whole point of a
// "Check Status" tracking table like the reference screenshots show.
export type ServiceTicket = {
  reference: string;
  ticket_id: string | null;
  status: string;
  message: string;
  amount: number;
  tracking_id: string | null;
  created_at: string;
  updated_at: string;
};

export function useServiceTickets(serviceKey: string) {
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const result = await api.get<{ status: boolean; data: ServiceTicket[] }>(`/verification/tickets?service=${encodeURIComponent(serviceKey)}`);
      setTickets(result.data ?? []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceKey]);

  return { tickets, loading, refresh };
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-success-500/15 text-success-600',
    pending: 'bg-gold-500/15 text-gold-700',
    failed: 'bg-ember-500/15 text-ember-600',
    reversed: 'bg-ember-500/15 text-ember-600'
  };
  const labels: Record<string, string> = { success: 'Completed', pending: 'Processing', failed: 'Rejected', reversed: 'Refunded' };
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${styles[status] ?? 'bg-blue-100 text-[#0b2f73]'}`}>{labels[status] ?? status}</span>;
}

/**
 * Small preview icons for each slip type, sitting above the label in
 * TierCardGrid — matching the reference design's use of a distinct little
 * card image per tier so the options are recognisable at a glance.
 * Deliberately ORIGINAL, abstract artwork (a generic card silhouette with a
 * photo circle / barcode / QR pattern) rather than any reproduction of the
 * actual NIMC card or logo, which is protected government design - these
 * only need to communicate "this is roughly what you'll receive", not be a
 * faithful likeness.
 */
export type SlipIconVariant = 'none' | 'regular' | 'standard' | 'premium' | 'document';

export function SlipIcon({ variant }: { variant: SlipIconVariant }) {
  if (variant === 'none') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9 text-white/50" fill="none">
        <rect x="4" y="7" width="32" height="26" rx="3" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
        <circle cx="15" cy="17" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6 29l7-7 5 5 6-8 10 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 'document') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="8" y="4" width="24" height="32" rx="2.5" fill="#f4f1e8" stroke="#c9c2ad" strokeWidth="1.5" />
        <rect x="13" y="11" width="14" height="2" rx="1" fill="#0b2f73" />
        <rect x="13" y="16" width="14" height="1.6" rx="0.8" fill="#9aa5c0" />
        <rect x="13" y="20" width="10" height="1.6" rx="0.8" fill="#9aa5c0" />
        <rect x="13" y="27" width="14" height="4" rx="1" fill="#d8b34a" />
      </svg>
    );
  }
  if (variant === 'regular') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#fbfaf5" stroke="#c9c2ad" strokeWidth="1.4" />
        <rect x="3" y="9" width="34" height="4" fill="#1f8a45" />
        <circle cx="11" cy="21" r="4.2" fill="#c7d0e4" stroke="#7f8bab" strokeWidth="1" />
        <rect x="18" y="17" width="15" height="1.6" rx="0.8" fill="#0b2f73" />
        <rect x="18" y="21" width="12" height="1.4" rx="0.7" fill="#9aa5c0" />
        <rect x="18" y="24.5" width="13" height="1.4" rx="0.7" fill="#9aa5c0" />
      </svg>
    );
  }
  if (variant === 'standard') {
    return (
      <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
        <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#e9ebef" stroke="#b7bdc9" strokeWidth="1.4" />
        <circle cx="11" cy="18" r="4.4" fill="#c3c8d1" stroke="#8b93a3" strokeWidth="1" />
        <rect x="4" y="26" width="32" height="4" fill="#232733" />
        {[6, 8.5, 11, 14.5, 17, 19.5, 22, 25.5, 28, 30.5, 33].map((x, i) => (
          <rect key={x} x={x} y="26.5" width={i % 3 === 0 ? 1.4 : 0.9} height="3" fill="#f5f5f7" />
        ))}
      </svg>
    );
  }
  // premium — the green e-NIN slip
  return (
    <svg viewBox="0 0 40 40" className="mx-auto h-9 w-9" fill="none">
      <rect x="3" y="9" width="34" height="22" rx="2.5" fill="#1f5c33" stroke="#123d20" strokeWidth="1.4" />
      <circle cx="11" cy="20" r="4.4" fill="#3d7d55" stroke="#a9d9b9" strokeWidth="1" />
      <rect x="18" y="15.5" width="15" height="1.5" rx="0.75" fill="#d9f2e1" />
      <rect x="18" y="19" width="11" height="1.3" rx="0.65" fill="#9dcbac" />
      <g fill="#e8f7ec">
        <rect x="28" y="22" width="2.2" height="2.2" />
        <rect x="31.2" y="22" width="2.2" height="2.2" />
        <rect x="28" y="25.2" width="2.2" height="2.2" />
        <rect x="31.2" y="25.2" width="1" height="1" />
      </g>
    </svg>
  );
}
