import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Fingerprint, IdCard, LayoutDashboard, LogOut, Menu, PackageOpen, ReceiptText, Smartphone, WalletCards, Wifi, X, Users } from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import MajorAssistant from './MajorAssistant';
import NotificationPopup from './NotificationPopup';

type Notice = { id: string; title: string; body: string; is_read: boolean; created_at: string };
const groups = [
  { label: 'VTU Services', icon: Wifi, items: [['Buy Data', '/buy-data'], ['Buy Airtime', '/buy-airtime']] },
  { label: 'NIN Services', icon: IdCard, items: [['All NIN Services', '/nin-services']] },
  { label: 'BVN Services', icon: Fingerprint, items: [['All BVN Services', '/bvn-services']] },
  { label: 'Result Checkers', icon: ReceiptText, items: [['WAEC / NECO / NABTEB', '/result-checkers']] },
  { label: 'My Deliveries', icon: PackageOpen, items: [['Download my files', '/deliveries']] },
] as const;

function Sidebar({ close }: { close?: () => void }) {
  const { logout } = useAuth(); const nav = useNavigate(); const [open, setOpen] = useState('VTU Services');
  const go = (to: string) => { close?.(); nav(to); };
  return <aside className="premium-sidebar flex h-full w-64 flex-col px-3 py-5"><Link to="/dashboard" onClick={close} className="mb-8 px-3"><Logo /></Link><nav className="flex-1 space-y-1"><NavLink to="/dashboard" onClick={close} className={({isActive}) => `premium-nav-link flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${isActive ? 'is-active' : ''}`}><LayoutDashboard size={18}/>Dashboard</NavLink><NavLink to="/fund-wallet" onClick={close} className={({isActive}) => `premium-nav-link flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${isActive ? 'is-active' : ''}`}><WalletCards size={18}/>Fund Wallet</NavLink><NavLink to="/referrals" onClick={close} className={({isActive}) => `premium-nav-link flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${isActive ? 'is-active' : ''}`}><Users size={18}/>Referrals</NavLink>{groups.map(({label, icon: Icon, items}) => <div key={label}><button onClick={() => setOpen(open === label ? '' : label)} className="premium-nav-link flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold"><Icon size={18}/><span className="flex-1 text-left">{label}</span><ChevronDown size={16} className={open === label ? 'rotate-180' : ''}/></button>{open === label && <div className="premium-subnav ml-6 border-l pl-3">{items.map(([label, to]) => <button key={to} onClick={() => go(to)} className="block w-full rounded-lg px-3 py-2 text-left text-xs">{label}</button>)}</div>}</div>)}</nav><button onClick={() => { logout(); close?.(); nav('/login'); }} className="premium-logout flex items-center gap-3 px-3 py-4 text-sm font-semibold"><LogOut size={18}/>Logout</button></aside>;
}

function NotificationBell() {
  const [items, setItems] = useState<Notice[]>([]); const [open, setOpen] = useState(false);
  const load = () => api.get<{data?: Notice[]}>('/notifications?limit=10').then(r => setItems(r.data ?? [])).catch(() => {});
  useEffect(() => { load(); const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer); }, []);
  const unread = items.filter(n => !n.is_read).length;
  async function toggle() { setOpen(v => !v); if (unread) { const ids = items.filter(n => !n.is_read).map(n => n.id); setItems(v => v.map(n => ({...n, is_read: true}))); await api.post('/notifications/read', {ids}).catch(() => {}); } }
  return <div className="relative"><button onClick={toggle} aria-label="Open notifications" className="relative rounded-xl border border-parchment-line bg-parchment p-2 text-gold-700 hover:bg-gold-50"><Bell size={19}/>{unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-ember-500 px-1 text-center text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>{open && <section className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-parchment-line bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-parchment-line px-4 py-3"><b className="text-sm text-ink">Recent notifications</b><button onClick={() => setOpen(false)} aria-label="Close notifications"><X size={17}/></button></header><div className="max-h-96 overflow-y-auto">{items.length ? items.map(n => <article key={n.id} className="border-b border-slate-100 px-4 py-3 last:border-0"><p className="text-sm font-bold text-ink">{n.title}</p><p className="mt-1 text-xs leading-5 text-ink-600">{n.body}</p><time className="mt-2 block text-[10px] text-slate-400">{new Date(n.created_at).toLocaleString()}</time></article>) : <p className="p-5 text-center text-sm text-ink-600">No notifications yet.</p>}</div></section>}</div>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="min-h-screen bg-[#f5f7fb]"><div className="fixed inset-y-0 left-0 z-30 hidden lg:block"><Sidebar/></div><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur lg:ml-64"><div className="flex h-16 items-center justify-between px-5"><button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-brand-700 lg:hidden"><Menu/></button><span className="hidden text-sm text-slate-500 sm:block">Welcome back, {user?.full_name?.split(' ')[0] ?? 'User'}</span><Link to="/dashboard" className="lg:hidden"><Logo/></Link><div className="flex items-center gap-3"><NotificationBell/><span className="flex items-center gap-2 text-sm font-medium text-slate-600"><Smartphone size={17} className="text-brand-600"/><span className="hidden sm:inline">Secure services</span></span></div></div></header>{mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-slate-950/35"/><div className="relative h-full"><button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-10 rounded-lg p-2"><X/></button><Sidebar close={() => setMobileOpen(false)}/></div></div>}<main className="px-5 py-7 lg:ml-64 lg:px-8">{children}</main><NotificationPopup/><MajorAssistant/></div>;
}
