import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@app/ui';

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,520px)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/" className="w-fit"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <h1 className="display text-[40px] text-ink">{title}</h1>
          {description && <p className="mt-2 text-[14.5px] text-muted">{description}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-[14px] text-muted">{footer}</div>}
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" aria-hidden />
        <div className="relative">
          <p className="font-serif text-[38px] leading-[1.1] text-white">Every transfer confirmed, every naira reconciled.</p>
          <div className="mt-10 space-y-3">
            {[['Customer transfer', '+₦25,000.00'], ['Processing fee', '−₦250.00'], ['Merchant payable', '₦24,750.00']].map(([k, v], i) => (
              <div key={k} className="flex justify-between border-t border-white/10 pt-3 text-[13.5px]">
                <span className="text-white/60">{k}</span>
                <span className={i === 2 ? 'tabular font-semibold text-white' : 'tabular text-white/80'}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
