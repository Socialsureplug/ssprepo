import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Link2, MoreHorizontal, Plus } from 'lucide-react';
import type { Paginated } from '@app/shared';
import { Alert, Button, Card, CopyButton, DataTable, Dialog, EmptyState, Field, Input, Money, PageHeader, StatusBadge, Textarea, formatDate, nairaToKobo, type Column } from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useSubmit, formValues } from '../auth/forms';
import { useModeQuery, QueryError } from './shared';

export interface LinkDTO {
  id: string; slug: string; url: string; title: string; amount: number | null; description: string | null; customerEmail: string | null; reference: string | null;
  successRedirectUrl: string | null; cancelRedirectUrl: string | null; expiresAt: string | null; status: string; createdAt: string; paymentsCount: number; totalCollected: number;
}

export default function PaymentLinksPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LinkDTO | null | 'new'>(null);
  const q = useModeQuery<Paginated<LinkDTO>>(['links'], '/dashboard/payment-links?pageSize=100');
  const canManage = session.permissions.includes('links.manage');
  const toggle = useMutation({
    mutationFn: (l: LinkDTO) => api.patch(`/dashboard/payment-links/${l.id}`, { status: l.status === 'disabled' ? 'active' : 'disabled' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const columns: Column<LinkDTO>[] = [
    { key: 'title', header: 'Link', primary: true, cell: (l) => <div className="min-w-0"><div className="font-medium text-ink">{l.title}</div><div className="truncate font-mono text-[11.5px] text-muted">{l.url.replace(/^https?:\/\//, '')}</div></div> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (l) => l.amount === null ? <span className="text-muted">Customer sets</span> : <Money amount={l.amount} /> },
    { key: 'payments', header: 'Payments', align: 'right', cell: (l) => <span className="tabular">{l.paymentsCount}</span> },
    { key: 'collected', header: 'Total collected', align: 'right', cell: (l) => <Money amount={l.totalCollected} className="font-medium" /> },
    { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'created', header: 'Created', hideOnMobile: true, cell: (l) => <span className="text-muted">{formatDate(l.createdAt, { time: false })}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', hideOnMobile: true,
      cell: (l) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <CopyButton value={l.url} label="Copy" variant="ghost" />
          <Dropdown.Root>
            <Dropdown.Trigger className="rounded-md p-1.5 hover:bg-surface-2" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" className="z-50 w-44 rounded-md border border-line bg-white p-1 text-[13.5px] shadow-pop">
                <Item onSelect={() => window.open(l.url, '_blank', 'noopener')}>Open</Item>
                <Item onSelect={() => navigate(`/dashboard/payment-links/${l.id}`)}>View payments</Item>
                {canManage && <Item onSelect={() => setEditing(l)}>Edit</Item>}
                {canManage && <Item onSelect={() => toggle.mutate(l)} danger={l.status !== 'disabled'}>{l.status === 'disabled' ? 'Enable' : 'Disable'}</Item>}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Payment links" description="Shareable links that let customers pay you by bank transfer — no code required."
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Create link</Button>} />
      <Card>
        {q.error ? <div className="p-4"><QueryError error={q.error} /></div> : (
          <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} rowKey={(l) => l.id} onRowClick={(l) => navigate(`/dashboard/payment-links/${l.id}`)}
            empty={<EmptyState icon={<Link2 className="h-5 w-5" />} title="Create your first payment link" description="Share it on WhatsApp, Instagram or by email and get paid by bank transfer." action={canManage && <Button onClick={() => setEditing('new')}>Create link</Button>} />} />
        )}
      </Card>
      {editing && <LinkFormDialog link={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Item({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => void; danger?: boolean }) {
  return <Dropdown.Item onSelect={onSelect} className={`cursor-pointer rounded px-3 py-2 outline-none data-[highlighted]:bg-surface ${danger ? 'text-danger' : ''}`}>{children}</Dropdown.Item>;
}

export function LinkFormDialog({ link, onClose }: { link: LinkDTO | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [fixed, setFixed] = useState(link ? link.amount !== null : true);
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const { submit, loading, error, fieldErrors, setError } = useSubmit(async (v: Record<string, string>) => {
    const amount = fixed ? nairaToKobo(v.amount) : null;
    if (fixed && (!amount || amount < 10_000)) { setError('Enter an amount of at least ₦100.'); return; }
    const body = {
      title: v.title, amount, currency: 'NGN', description: v.description, customerEmail: v.customerEmail, reference: v.reference,
      expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null, successRedirectUrl: v.successRedirectUrl, cancelRedirectUrl: v.cancelRedirectUrl,
    };
    const res = link ? await api.patch<LinkDTO>(`/dashboard/payment-links/${link.id}`, body) : await api.post<LinkDTO>('/dashboard/payment-links', body);
    await qc.invalidateQueries();
    if (link) onClose(); else setCreated(res);
  });

  if (created) {
    return (
      <Dialog open onOpenChange={onClose} title="Your link is ready" footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-[14px] text-muted">Share this link with your customers:</p>
        <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-surface p-2 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{created.url}</span>
          <CopyButton value={created.url} variant="primary" />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={onClose} title={link ? 'Edit payment link' : 'Create payment link'} wide>
      <form id="link-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Title" htmlFor="title" error={fieldErrors.title}><Input id="title" name="title" defaultValue={link?.title} placeholder="Annual membership" required /></Field>
        <div className="flex gap-2 text-[13px]" role="radiogroup" aria-label="Amount type">
          {[[true, 'Fixed amount'], [false, 'Customer enters amount']].map(([v, l]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={fixed === v} onClick={() => setFixed(v as boolean)}
              className={`rounded-md border px-3 py-1.5 ${fixed === v ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line text-ink-2'}`}>{l as string}</button>
          ))}
        </div>
        {fixed && <Field label="Amount (₦)" htmlFor="amount" error={fieldErrors.amount}><Input id="amount" name="amount" inputMode="decimal" defaultValue={link?.amount ? (link.amount / 100).toFixed(2) : ''} required /></Field>}
        <Field label="Description" htmlFor="description"><Textarea id="description" name="description" rows={2} defaultValue={link?.description ?? ''} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer email (optional)" htmlFor="customerEmail" error={fieldErrors.customerEmail} hint="Pre-fills checkout for a specific customer."><Input id="customerEmail" name="customerEmail" type="email" defaultValue={link?.customerEmail ?? ''} /></Field>
          <Field label="Reference (optional)" htmlFor="reference"><Input id="reference" name="reference" defaultValue={link?.reference ?? ''} /></Field>
          <Field label="Expires (optional)" htmlFor="expiresAt"><Input id="expiresAt" name="expiresAt" type="datetime-local" defaultValue={link?.expiresAt ? link.expiresAt.slice(0, 16) : ''} /></Field>
          <div className="hidden sm:block" />
          <Field label="Success redirect URL" htmlFor="successRedirectUrl" error={fieldErrors.successRedirectUrl}><Input id="successRedirectUrl" name="successRedirectUrl" type="url" placeholder="https://" defaultValue={link?.successRedirectUrl ?? ''} /></Field>
          <Field label="Cancel redirect URL" htmlFor="cancelRedirectUrl" error={fieldErrors.cancelRedirectUrl}><Input id="cancelRedirectUrl" name="cancelRedirectUrl" type="url" placeholder="https://" defaultValue={link?.cancelRedirectUrl ?? ''} /></Field>
        </div>
      </form>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="link-form" loading={loading}>{link ? 'Save changes' : 'Create link'}</Button>
      </div>
    </Dialog>
  );
}
