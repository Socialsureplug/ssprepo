import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react';
import type { Paginated, PaymentDTO } from '@app/shared';
import { Button, Card, CardHeader, CopyButton, DataTable, DescriptionList, EmptyState, Money, Spinner, Stat, StatusBadge, formatDate, buttonVariants } from '@app/ui';
import { useModeQuery, paymentColumns, QueryError } from './shared';
import { LinkFormDialog, type LinkDTO } from './PaymentLinksPage';
import { useSession } from '../lib/session';

export default function PaymentLinkDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [editing, setEditing] = useState(false);
  const link = useModeQuery<LinkDTO>(['link', id], `/dashboard/payment-links/${id}`);
  const payments = useModeQuery<Paginated<PaymentDTO>>(['payments', 'link', id], `/dashboard/payments?linkId=${id}`);
  if (link.isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (link.error) return <QueryError error={link.error} />;
  const l = link.data!;
  return (
    <>
      <Link to="/dashboard/payment-links" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Payment links</Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3"><h1 className="text-[28px] font-semibold tracking-tight">{l.title}</h1><StatusBadge status={l.status} /></div>
          <div className="mt-2 flex items-center gap-2"><span className="truncate font-mono text-[13px] text-muted">{l.url}</span><CopyButton value={l.url} /></div>
        </div>
        <div className="flex gap-2">
          <a href={l.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'secondary' })}><ExternalLink className="h-4 w-4" />Open</a>
          {session.permissions.includes('links.manage') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
        </div>
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="grid grid-cols-2 gap-6 p-5">
          <Stat label="Total collected" value={<Money amount={l.totalCollected} />} />
          <Stat label="Successful payments" value={l.paymentsCount} />
        </Card>
        <Card className="px-5 py-2">
          <DescriptionList items={[
            { label: 'Amount', value: l.amount === null ? 'Customer enters amount' : <Money amount={l.amount} /> },
            { label: 'Description', value: l.description },
            { label: 'Expires', value: l.expiresAt ? formatDate(l.expiresAt) : 'Never' },
            { label: 'Created', value: formatDate(l.createdAt) },
          ]} />
        </Card>
      </div>
      <Card>
        <CardHeader title="Payments through this link" />
        <DataTable columns={paymentColumns} rows={payments.data?.items} loading={payments.isLoading} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/dashboard/transactions/${p.id}`)}
          empty={<EmptyState title="No payments yet" description="Payments made through this link will appear here." />} />
      </Card>
      {editing && <LinkFormDialog link={l} onClose={() => setEditing(false)} />}
    </>
  );
}
