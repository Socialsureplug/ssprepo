import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { PaymentDTO } from '@app/shared';
import { Alert, Button, Dialog, Field, Input, Select, Textarea, nairaToKobo } from '@app/ui';
import { api } from '../lib/api';
import { useSubmit, formValues } from '../auth/forms';

/** Create a payment request from the dashboard. Fees are computed by the server and shown afterwards. */
export function CreatePaymentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [amountError, setAmountError] = useState<string>();
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    const amount = nairaToKobo(v.amount);
    if (!amount || amount < 10_000) { setAmountError('Enter an amount of at least ₦100.'); return; }
    setAmountError(undefined);
    const p = await api.post<PaymentDTO>('/dashboard/payments', {
      amount, email: v.email, name: v.name || undefined, reference: v.reference || undefined,
      description: v.description || undefined, expiresInMinutes: Number(v.expiresInMinutes),
    });
    await qc.invalidateQueries();
    onOpenChange(false);
    navigate(`/dashboard/transactions/${p.id}`);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New payment request" description="We'll generate dedicated bank details and a checkout link for this payment.">
      <form id="create-payment" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Amount (₦)" htmlFor="amount" error={amountError ?? fieldErrors.amount}><Input id="amount" name="amount" inputMode="decimal" placeholder="25,000.00" required autoFocus /></Field>
        <Field label="Customer email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" htmlFor="name"><Input id="name" name="name" /></Field>
          <Field label="Your reference" htmlFor="reference" error={fieldErrors.reference} hint="e.g. ORDER-12345"><Input id="reference" name="reference" /></Field>
        </div>
        <Field label="Description" htmlFor="description"><Textarea id="description" name="description" rows={2} /></Field>
        <Field label="Expires after" htmlFor="expiresInMinutes">
          <Select id="expiresInMinutes" name="expiresInMinutes" defaultValue="30">
            <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option>
          </Select>
        </Field>
      </form>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="create-payment" loading={loading}>Create payment</Button>
      </div>
    </Dialog>
  );
}
