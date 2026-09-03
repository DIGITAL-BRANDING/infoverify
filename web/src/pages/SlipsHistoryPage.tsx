import { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type SlipEntry = {
  reference: string;
  status: string;
  created_at: string;
  service: string | null;
  pdf_base64: string | null;
  pdf_url: string | null;
  ticket_id: string | null;
};

// Turns a raw service key like "NIN_PHONE_SLIP_PREMIUM" into "Nin Phone Slip Premium".
function friendlyService(service: string | null) {
  if (!service) return 'Verification slip';
  return service
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function SlipsHistoryPage() {
  const [items, setItems] = useState<SlipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ status: boolean; data: SlipEntry[] }>('/verification/history/all')
      .then((r) => setItems(r.data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load your slip history.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="max-w-3xl">
        <header className="rounded-2xl border border-gold-500/40 bg-ink p-6 text-cream shadow-xl">
          <p className="text-sm font-semibold text-gold-300">Account resources</p>
          <h1 className="mt-1 text-3xl font-bold">Slips History</h1>
          <p className="mt-2 text-sm text-cream/70">
            Successful NIN, BVN and identity service slips from the last 7 days. Download the PDF again anytime within that window.
          </p>
        </header>

        <section className="mt-6 space-y-3">
          {error && <p className="rounded-xl bg-ember-500/10 p-4 text-sm text-ember-600">{error}</p>}
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-gold-500" />
            </div>
          )}
          {!loading && !items.length && !error && (
            <div className="rounded-2xl border border-gold-500/30 bg-ink-soft p-10 text-center text-cream/70">
              <FileText className="mx-auto mb-3 text-gold-400" />
              <p>No verification slips in the last 7 days.</p>
            </div>
          )}
          {items.map((entry) => {
            const base64 = entry.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
            const href = base64 ? `data:application/pdf;base64,${base64}` : entry.pdf_url?.startsWith('https://') ? entry.pdf_url : null;
            return (
              <article
                key={entry.reference}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold-500/35 bg-ink p-4 text-cream shadow-lg"
              >
                <div className="min-w-0">
                  <h2 className="font-semibold text-gold-200">{friendlyService(entry.service)}</h2>
                  <p className="mt-1 break-all font-mono text-xs text-cream/65">{entry.reference}</p>
                  <p className="mt-1 text-xs text-cream/65">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
                {href ? (
                  <a
                    href={href}
                    download={`${entry.reference}.pdf`}
                    target={base64 ? undefined : '_blank'}
                    rel={base64 ? undefined : 'noreferrer'}
                    className="flex shrink-0 items-center gap-2 rounded-xl bg-gold-500 px-3 py-2 text-sm font-bold text-ink hover:bg-gold-400"
                  >
                    <Download size={16} /> Download
                  </a>
                ) : (
                  <span className="shrink-0 rounded-full bg-cream/10 px-3 py-1 text-xs font-semibold capitalize text-cream/70">{entry.status}</span>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
