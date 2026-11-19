import { useQuery, type QueryKey } from '@tanstack/react-query';
import type { PaymentDTO } from '@app/shared';
import { Money, StatusBadge, formatDate, type Column, Alert, Button } from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

/** Data hook scoped to the current environment so test and live data never mix in the cache. */
export function useModeQuery<T>(key: QueryKey, path: string, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  const { session } = useSession();
  return useQuery({ queryKey: [session.mode, ...key], queryFn: () => api.get<T>(path), ...opts });
}

export function QueryError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return <Alert tone="danger" title="We couldn't load this" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}>{error.message}</Alert>;
}

export const paymentColumns: Column<PaymentDTO>[] = [
  { key: 'reference', header: 'Reference', primary: true, cell: (p) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
  { key: 'customer', header: 'Customer', cell: (p) => <span className="block max-w-[220px] truncate">{p.customer?.email ?? '—'}</span> },
  { key: 'amount', header: 'Amount', align: 'right', cell: (p) => <Money amount={p.amount} className="font-medium" /> },
  { key: 'method', header: 'Payment method', hideOnMobile: true, cell: () => <span className="text-muted">Bank transfer</span> },
  { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  { key: 'date', header: 'Date', cell: (p) => <span className="whitespace-nowrap text-muted">{formatDate(p.createdAt)}</span> },
];
