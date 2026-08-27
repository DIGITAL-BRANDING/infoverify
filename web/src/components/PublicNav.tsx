import { Link } from 'react-router-dom';
import Logo from './Logo';
import { useAuth } from '../lib/auth';

export default function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-50 border-b border-ink-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link to="/">
          <Logo dark />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#result-checkers" className="font-body text-sm text-cream/70 transition hover:text-cream">
            Results
          </a>
          <a href="#how-it-works" className="font-body text-sm text-cream/70 transition hover:text-cream">
            How it works
          </a>
          <a href="#download" className="font-body text-sm text-cream/70 transition hover:text-cream">
            Get the app
          </a>
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="rounded-lg bg-gold-500 px-4 py-2 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden font-body text-sm text-cream/80 transition hover:text-cream sm:block"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-gold-500 px-4 py-2 font-display text-sm font-semibold text-ink transition hover:bg-gold-400"
              >
                Create Account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
