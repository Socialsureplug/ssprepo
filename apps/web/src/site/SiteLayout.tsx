import { useState, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { BRAND } from '@app/shared';
import { Logo, buttonVariants, cn } from '@app/ui';

const NAV = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/developers', label: 'Developers' },
  { to: '/docs', label: 'Documentation' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export function SiteLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label={`${BRAND.name} home`}><Logo /></Link>
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('text-[14px] transition-colors hover:text-ink', isActive ? 'text-ink' : 'text-muted')}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Sign in</Link>
            <Link to="/signup" className={buttonVariants({ size: 'sm' })}>Start accepting payments</Link>
          </div>
          <button className="rounded-md p-2 text-ink lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-line bg-white px-5 pb-6 pt-2 lg:hidden">
            <nav className="flex flex-col" aria-label="Mobile">
              {NAV.map((n) => <Link key={n.to} to={n.to} className="border-b border-line py-3.5 text-[15px] text-ink">{n.label}</Link>)}
            </nav>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Link to="/login" className={buttonVariants({ variant: 'secondary' })}>Sign in</Link>
              <Link to="/signup" className={buttonVariants()}>Get started</Link>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1"><Outlet /></main>
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  const cols = [
    { title: 'Product', links: [['Bank transfers', '/'], ['Payment links', '/#payment-links'], ['Dashboard', '/#dashboard'], ['Pricing', '/pricing']] },
    { title: 'Developers', links: [['Overview', '/developers'], ['Documentation', '/docs'], ['API reference', '/docs#api'], ['Webhooks', '/docs#webhooks']] },
    { title: 'Company', links: [['About', '/about'], ['Contact', '/contact'], ['Sign in', '/login'], ['Create account', '/signup']] },
  ];
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted">{BRAND.tagline}</p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="eyebrow">{c.title}</div>
              <ul className="mt-4 space-y-2.5">
                {c.links.map(([label, to]) => <li key={label}><Link to={to} className="text-[14px] text-ink-2 hover:text-primary">{label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[12.5px] leading-relaxed text-muted md:flex-row md:justify-between">
          <p>© {new Date().getFullYear()} {BRAND.legalName}. All rights reserved.</p>
          <p className="max-w-xl md:text-right">
            {BRAND.name} is a technology platform. Collections and payouts are processed by licensed banking and payment partners; customer funds are held by those partners, not by {BRAND.name}.
          </p>
        </div>
      </div>
    </footer>
  );
}
