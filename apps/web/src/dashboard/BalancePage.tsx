import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Landmark, Wallet } from 'lucide-react';
import { formatMoney, type Paginated } from '@app/shared';
import {
  Alert, Button, Card, CardHeader, DataTable, Dialog, EmptyState, Field, Input, Money, PageHeader, Select, Stat, StatusBadge, formatDate, humanize, nairaToKobo, newIdempotencyKey, cn, type Column,
} from '@app/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useModeQuery, QueryError } from './shared';

interface Balance {
  available: number; pending: number; payoutFee: number; settlementSchedule: 't0' | 't1' | 'manual'; dailyWithdrawalLimit: number;
  activity: { id: string; kind: string; description: string; created_at: string; account: string; direction: 'debit' | 'credit'; amount: number }[];
}
interface Withdrawal { id: string; reference: string; amount: number; fee: number; netAmount: number; status: string; riskFlags: string[]; failureReason: string | null; createdAt: string; bankAccount: { bankName: string; last4: string } | null }
interface BankAccount { id: string; bank_name: string; account_number_last4: string; account_name: string; is_default: boolean }

const SCHEDULE: Record<string, string> = { t0: 'Same day (T+0)', t1: 'Next day (T+1)', manual: 'Manual — withdraw on demand' };

export default function BalancePage() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const b = useModeQuery<Balance>(['balance'], '/dashboard/balance');
  const w = useModeQuery<Paginated<Withdrawal>>(['withdrawals'], '/dashboard/withdrawals');
  const canWithdraw = session.permissions.includes('withdrawals.create');

  const wColumns: Column<Withdrawal>[] = [
    { key: 'ref', header: 'Reference', primary: true, cell: (x) => <span className="font-mono text-[12.5px]">{x.reference}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (x) => <Money amount={x.amount} /> },
    { key: 'fee', header: 'Fee', align: 'right', hideOnMobile: true, cell: (x) => <Money amount={x.fee} className="text-muted" /> },
    { key: 'net', header: 'Net to bank', align: 'right', cell: (x) => <Money amount={x.netAmount} className="font-medium" /> },
    { key: 'dest', header: 'Destination', cell: (x) => x.bankAccount ? `${x.bankAccount.bankName} ••${x.bankAccount.last4}` : '—' },
    { key: 'status', header: 'Status', cell: (x) => <span title={x.failureReason ?? undefined}><StatusBadge status={x.status} label={x.status === 'pending' && x.riskFlags.length ? 'In review' : undefined} /></span> },
    { key: 'date', header: 'Date', cell: (x) => <span className="text-muted">{formatDate(x.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader title="Balance" description="Your funds, derived directly from the ledger." actions={canWithdraw && <Button onClick={() => setOpen(true)} disabled={!b.data?.available}><ArrowUpRight className="h-4 w-4" />Withdraw</Button>} />
      {b.error && <QueryError error={b.error} />}
      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start justify-between"><Stat emphasis label="Available balance" value={formatMoney(b.data?.available ?? 0)} sub="Withdrawable now" /><Wallet className="h-5 w-5 text-primary" /></div>
        </Card>
        <Card className="p-6">
          <div className="flex items-start justify-between"><Stat emphasis label="Pending balance" value={formatMoney(b.data?.pending ?? 0)} sub={b.data ? `Settles: ${SCHEDULE[b.data.settlementSchedule]}` : undefined} /><Landmark className="h-5 w-5 text-muted" /></div>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader title="Withdrawals" description={b.data ? `Fee ${formatMoney(b.data.payoutFee)} per withdrawal · daily limit ${formatMoney(b.data.dailyWithdrawalLimit)}` : undefined} />
        <DataTable columns={wColumns} rows={w.data?.items} loading={w.isLoading} rowKey={(x) => x.id}
          empty={<EmptyState title="No withdrawals yet" description="Withdraw your available balance to your settlement bank account at any time." />} />
      </Card>
      <Card>
        <CardHeader title="Balance activity" description="Recent ledger movements on your pending and available balances." />
        {b.data?.activity.length ? (
          <div className="divide-y divide-line">
            {b.data.activity.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px]">
                <div className="min-w-0"><div className="truncate text-ink">{a.description}</div><div className="text-[12px] text-muted">{humanize(a.account.replace('merchant_', ''))} · {formatDate(a.created_at)}</div></div>
                <span className={cn('tabular shrink-0 font-medium', a.direction === 'credit' ? 'text-success' : 'text-ink')}>{a.direction === 'credit' ? '+' : '−'}{formatMoney(a.amount)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No balance activity" description="Movements appear here when payments are confirmed, settled, refunded or withdrawn." />}
      </Card>
      {open && b.data && <WithdrawDialog balance={b.data} onClose={() => setOpen(false)} />}
    </>
  );
}

function WithdrawDialog({ balance, onClose }: { balance: Balance; onClose: () => void }) {
  const qc = useQueryClient();
  const banks = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<BankAccount[]>('/dashboard/settings/bank-accounts') });
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const kobo = nairaToKobo(amount);
  const selectedBank = banks.data?.find((x) => x.id === (bankId || banks.data?.find((y) => y.is_default)?.id));
  const problem = useMemo(() => {
    if (!amount) return null;
    if (kobo === null) return 'Enter a valid amount.';
    if (kobo < 10_000) return 'Minimum withdrawal is ₦100.';
    if (kobo > balance.available) return `You can withdraw up to ${formatMoney(balance.available)}.`;
    if (kobo <= balance.payoutFee) return 'Amount must be greater than the withdrawal fee.';
    return null;
  }, [amount, kobo, balance]);
  const m = useMutation({
    mutationFn: () => api.post('/dashboard/withdrawals', { amount: kobo, bankAccountId: selectedBank!.id }, { 'Idempotency-Key': key }),
    onSuccess: () => { void qc.invalidateQueries(); onClose(); },
  });
  const ready = kobo && !problem && selectedBank;

  return (
    <Dialog open onOpenChange={onClose} title={confirming ? 'Confirm withdrawal' : 'Withdraw funds'}
      footer={confirming
        ? <><Button variant="secondary" onClick={() => setConfirming(false)}>Back</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Confirm withdrawal</Button></>
        : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ready} onClick={() => setConfirming(true)}>Continue</Button></>}>
      {banks.data && banks.data.length === 0 ? (
        <Alert tone="warning" title="Add a settlement account first" action={<Link to="/dashboard/settings?tab=bank"><Button size="sm" variant="secondary">Add account</Button></Link>}>Withdrawals can only go to a verified settlement bank account.</Alert>
      ) : confirming && ready ? (
        <div className="space-y-4">
          {m.error && <Alert tone="danger">{m.error.message}</Alert>}
          <div className="divide-y divide-line rounded-md border border-line text-[14px]">
            {[['Withdrawal amount', formatMoney(kobo!)], ['Fee', `−${formatMoney(balance.payoutFee)}`], ['You receive', formatMoney(kobo! - balance.payoutFee)], ['Destination', `${selectedBank!.bank_name} ••••${selectedBank!.account_number_last4}`], ['Account name', selectedBank!.account_name]].map(([k, v], i) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><span className="text-muted">{k}</span><span className={cn('tabular text-right', i === 2 && 'font-semibold text-primary')}>{v}</span></div>
            ))}
          </div>
          <p className="text-[12.5px] text-muted">Transfers are usually completed within minutes. Withdrawals to newly added accounts may be held for a security review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-surface px-4 py-3 text-[13.5px]"><span className="text-muted">Available balance</span><span className="tabular float-right font-semibold">{formatMoney(balance.available)}</span></div>
          <Field label="Amount (₦)" htmlFor="wamount" error={problem ?? undefined}>
            <div className="flex gap-2">
              <Input id="wamount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
              <Button type="button" variant="secondary" onClick={() => setAmount((balance.available / 100).toFixed(2))}>Max</Button>
            </div>
          </Field>
          <Field label="Destination account" htmlFor="wbank">
            <Select id="wbank" value={selectedBank?.id ?? ''} onChange={(e) => setBankId(e.target.value)}>
              {banks.data?.map((x) => <option key={x.id} value={x.id}>{x.bank_name} ••••{x.account_number_last4} — {x.account_name}</option>)}
            </Select>
          </Field>
          {kobo && !problem && (
            <div className="text-[13px] text-muted">Fee {formatMoney(balance.payoutFee)} · you receive <strong className="tabular text-ink">{formatMoney(kobo - balance.payoutFee)}</strong></div>
          )}
        </div>
      )}
    </Dialog>
  );
}
