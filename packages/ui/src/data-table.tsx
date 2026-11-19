import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, Skeleton, Button } from './components';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Hide from the mobile card layout (still shown on desktop). */
  hideOnMobile?: boolean;
  /** Shown as the bold title line of the mobile card. */
  primary?: boolean;
}

/**
 * Responsive table: a dense table on desktop, stacked cards on phones.
 * Rows are keyboard-accessible links when `onRowClick` is provided.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty, footer }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; onRowClick?: (r: T) => void; loading?: boolean; empty?: React.ReactNode; footer?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }
  if (!rows || rows.length === 0) return <>{empty}</>;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line bg-surface/60">
              {columns.map((c) => (
                <th key={c.key} className={cn('whitespace-nowrap px-5 py-2.5 text-[12px] font-medium text-muted', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-surface focus:bg-surface focus:outline-none')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-5 py-3 align-middle text-ink', c.align === 'right' && 'text-right', c.className)}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>
            <div
              role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}
              className={cn('flex flex-col gap-2 px-4 py-3.5', onRowClick && 'active:bg-surface')}
            >
              <div className="text-[14px] font-medium text-ink">{primary.cell(r)}</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {columns.filter((c) => c !== primary && !c.hideOnMobile).map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11.5px] text-muted">{c.header}</dt>
                    <dd className="truncate text-[13px] text-ink">{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
      {footer}
    </>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total?: number; onPage: (p: number) => void }) {
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-muted">
      <span>{total !== undefined ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}` : `Page ${page}`}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        {pages && <span className="tabular">{page} / {pages}</span>}
        <Button variant="secondary" size="sm" disabled={pages !== undefined && page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
