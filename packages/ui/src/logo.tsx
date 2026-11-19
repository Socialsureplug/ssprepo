import { BRAND } from '@app/shared';
import { cn } from './components';

/** Wordmark: a simple geometric mark (two transfer rails) plus the serif brand name. */
export function Logo({ className, inverted, suffix }: { className?: string; inverted?: boolean; suffix?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect x="0.5" y="0.5" width="21" height="21" rx="5" fill={inverted ? '#ffffff' : '#1546e0'} />
        <path d="M6 8.5h8.5l-2-2M16 13.5H7.5l2 2" stroke={inverted ? '#1546e0' : '#ffffff'} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={cn('font-serif text-[22px] leading-none tracking-tight', inverted ? 'text-white' : 'text-ink')}>{BRAND.name}</span>
      {suffix && <span className={cn('ml-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider', inverted ? 'bg-white/15 text-white' : 'bg-ink text-white')}>{suffix}</span>}
    </span>
  );
}
