import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Loader2, X, AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react';
import { formatMoney } from '@app/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ------------------------------------------------------------------ Button
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover',
        secondary: 'bg-white text-ink border border-line-strong hover:bg-surface',
        ghost: 'text-ink-2 hover:bg-surface-2',
        danger: 'bg-danger text-white hover:bg-danger/90',
        dark: 'bg-ink text-white hover:bg-ink-2',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
      },
      size: { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4', lg: 'h-12 px-6 text-[15px]', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

// ------------------------------------------------------------------ Form controls
const fieldBase = 'w-full rounded-md border border-line-strong bg-white px-3 text-[14px] text-ink placeholder:text-subtle transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/12 disabled:bg-surface disabled:text-muted aria-[invalid=true]:border-danger';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-24 py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, 'h-10 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27none%27 stroke=%27%235d6677%27 stroke-width=%271.5%27%3E%3Cpath d=%27M3 4.5l3 3 3-3%27/%3E%3C/svg%3E")] bg-[right_12px_center] bg-no-repeat pr-9', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium text-ink-2', className)} {...props} />;
}

export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-[12.5px] text-danger" role="alert">{error}</p> : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Surfaces
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-white shadow-card', className)} {...props} />;
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, emphasis }: { label: string; value: React.ReactNode; sub?: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12.5px] font-medium text-muted">{label}</span>
      <span className={cn('tabular truncate text-ink', emphasis ? 'font-serif text-[40px] leading-none tracking-tight' : 'text-[22px] font-semibold tracking-tight')}>{value}</span>
      {sub && <span className="text-[12.5px] text-muted">{sub}</span>}
    </div>
  );
}

export function Money({ amount, className, compact }: { amount: number | null | undefined; className?: string; compact?: boolean }) {
  if (amount === null || amount === undefined) return <span className={className}>—</span>;
  return <span className={cn('tabular', className)}>{formatMoney(amount, 'NGN', { compact, decimals: !Number.isInteger(amount / 100) })}</span>;
}

// ------------------------------------------------------------------ Status badges
const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  successful: 'success', completed: 'success', approved: 'success', active: 'success', succeeded: 'success', operational: 'success', resolved: 'success', processed: 'success', normal: 'success', matched: 'success',
  pending: 'warning', processing: 'info', created: 'neutral', under_review: 'info', investigating: 'info', retrying: 'warning', review: 'warning', degraded: 'warning', received: 'info', invited: 'info',
  failed: 'danger', expired: 'neutral', reversed: 'danger', rejected: 'danger', restricted: 'danger', blocked: 'danger', unavailable: 'danger', suspended: 'danger', open: 'warning', disabled: 'neutral',
  refunded: 'neutral', partially_refunded: 'neutral', not_started: 'neutral', ignored: 'neutral', dismissed: 'neutral', reviewed: 'success', high: 'danger', medium: 'warning', low: 'neutral',
};
const TONE_CLASS = {
  success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-ink-2', info: 'bg-primary-soft text-primary-ink',
};
export function humanize(s: string) {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', TONE_CLASS[tone], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {label ?? humanize(status)}
    </span>
  );
}
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-sm border border-line px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2', className)} {...props} />;
}

// ------------------------------------------------------------------ Feedback
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} aria-label="Loading" />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function Alert({ tone = 'info', title, children, action, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const Icon = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  const tones = {
    info: 'border-primary/20 bg-primary-soft text-primary-ink', warning: 'border-warning/25 bg-warning-soft text-warning',
    danger: 'border-danger/25 bg-danger-soft text-danger', success: 'border-success/25 bg-success-soft text-success',
  };
  return (
    <div className={cn('flex flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center', tones[tone], className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px]">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface text-muted">{icon}</div>}
      <h3 className="font-serif text-[26px] leading-tight text-ink">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-[14px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', className, size = 'sm', variant = 'secondary' }: { value: string; label?: string; className?: string; size?: 'sm' | 'md' | 'lg'; variant?: 'secondary' | 'ghost' | 'primary' }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button" size={size} variant={variant} className={className}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); } catch { /* clipboard blocked: selection fallback is the visible value */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      aria-live="polite"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

// ------------------------------------------------------------------ Dialog
export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/30 animate-fade-in" />
        <DialogPrimitive.Content className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-lg border border-line bg-white shadow-pop animate-slide-up focus:outline-none',
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg', wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-[16px] font-semibold text-ink">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ------------------------------------------------------------------ Tabs (link or state driven)
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {items.map((i) => (
        <button
          key={i.value} role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
            value === i.value ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Key/value list
export function DescriptionList({ items, className }: { items: { label: string; value: React.ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <dt className="text-[13px] text-muted">{i.label}</dt>
          <dd className={cn('min-w-0 break-words text-[13.5px] text-ink sm:text-right', i.mono && 'font-mono text-[12.5px]')}>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
