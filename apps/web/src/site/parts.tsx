import { useState, type ReactNode } from 'react';
import { Plus, Minus } from 'lucide-react';
import { cn, CopyButton } from '@app/ui';

export function Section({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-20', className)}>
      <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">{children}</div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, description, align = 'center' }: { eyebrow?: string; title: string; description?: string; align?: 'center' | 'left' }) {
  return (
    <div className={cn(align === 'center' && 'mx-auto max-w-2xl text-center')}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h2 className="display mt-3 text-[38px] text-ink sm:text-[50px]">{title}</h2>
      {description && <p className={cn('mt-4 text-[16px] leading-relaxed text-muted', align === 'center' && 'mx-auto max-w-xl')}>{description}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, description, children }: { eyebrow: string; title: ReactNode; description?: string; children?: ReactNode }) {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-24">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display mt-4 max-w-4xl text-[46px] text-ink sm:text-[64px]">{title}</h1>
        {description && <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-2">{description}</p>}
        {children}
      </div>
    </section>
  );
}

export function CodeBlock({ tabs, dark, className }: { tabs: { label: string; code: string }[]; dark?: boolean; className?: string }) {
  const [active, setActive] = useState(0);
  return (
    <div className={cn('overflow-hidden rounded-lg border', dark ? 'border-white/10 bg-[#0e1527]' : 'border-line bg-[#0e1527]', className)}>
      <div className="flex items-center justify-between border-b border-white/10 px-2">
        <div className="flex" role="tablist">
          {tabs.map((t, i) => (
            <button key={t.label} role="tab" aria-selected={i === active} onClick={() => setActive(i)}
              className={cn('px-3 py-2.5 text-[12.5px] font-medium', i === active ? 'text-white' : 'text-white/45 hover:text-white/75')}>
              {t.label}
            </button>
          ))}
        </div>
        <CopyButton value={tabs[active].code} variant="ghost" className="text-white/60 hover:bg-white/10 hover:text-white" />
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.7] text-[#d6dcf0]"><code>{tabs[active].code}</code></pre>
    </div>
  );
}

export function FAQ({ items }: { items: [string, string][] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map(([q, a], i) => (
        <div key={q}>
          <button className="flex w-full items-center justify-between gap-6 py-5 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span className="text-[16px] font-medium text-ink">{q}</span>
            {open === i ? <Minus className="h-4 w-4 shrink-0 text-muted" /> : <Plus className="h-4 w-4 shrink-0 text-muted" />}
          </button>
          {open === i && <p className="-mt-1 pb-5 pr-10 text-[14.5px] leading-relaxed text-muted animate-fade-in">{a}</p>}
        </div>
      ))}
    </div>
  );
}
