export default function Logo({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/branding/logo.png" alt="" className="h-9 w-9 rounded-lg object-cover" />
      <span
        className={`font-display text-lg font-bold tracking-tight ${
          dark ? 'text-cream' : 'text-ink'
        }`}
      >
        MAJOR <span className="text-gold-500">DATA-LINK</span>
      </span>
    </div>
  );
}
