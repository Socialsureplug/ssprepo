import crypto from 'node:crypto';
import { pool, one, query } from '../../db/pool';
import { hmacSha512Hex, safeEqual } from '../../lib/crypto';
import { enqueue } from '../../jobs/queue';
import type {
  PaymentProvider, ProviderContext, CreateAccountInput, CollectionAccount, PaymentStatusResult, ProviderTransaction,
  RefundInput, TransferInput, TransferResult, NormalizedWebhookEvent,
} from '../types';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

/**
 * Built-in sandbox provider for TEST MODE ONLY. It behaves like an external bank:
 * it issues dynamic account numbers, records "transfers" in its own tables and notifies the
 * platform via signed webhooks that go through the exact same pipeline a real provider uses.
 *
 * Magic values for testing:
 *  - payout/settlement to an account number ending in 0000 fails
 *  - a refund with reason containing "fail" fails
 */
export class SandboxProvider implements PaymentProvider {
  readonly adapter = 'sandbox';
  constructor(private readonly ctx: ProviderContext) {}

  private get secret() { return this.ctx.credentials.webhookSecret ?? 'sandbox-webhook-secret'; }

  async createPaymentAccount(input: CreateAccountInput): Promise<CollectionAccount> {
    // 10-digit NUBAN-shaped number in a reserved sandbox range.
    for (let i = 0; i < 5; i++) {
      const accountNumber = '99' + crypto.randomInt(0, 99_999_999).toString().padStart(8, '0');
      const accountName = `${input.merchantName.slice(0, 40)} Checkout`;
      const inserted = await one(
        pool,
        `INSERT INTO sandbox_provider_accounts (account_number, reference, expected_amount, account_name, expires_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING account_number`,
        [accountNumber, input.reference, input.amount, accountName, input.expiresAt],
      );
      if (inserted) {
        return {
          providerReference: `sbx_va_${input.reference}`,
          bankName: 'Sandbox Bank',
          accountName,
          accountNumber,
          expiresAt: input.expiresAt,
          raw: { sandbox: true },
        };
      }
    }
    throw new Error('Sandbox could not allocate an account number');
  }

  async getPaymentStatus(account: { accountNumber: string }): Promise<PaymentStatusResult> {
    const acct = await one(pool, `SELECT * FROM sandbox_provider_accounts WHERE account_number=$1`, [account.accountNumber]);
    const txns = await query(pool, `SELECT * FROM sandbox_provider_transactions WHERE account_number=$1 AND kind='collection'`, [account.accountNumber]);
    const mapped = txns.map(toTxn);
    if (mapped.some((t) => t.status === 'completed')) return { status: 'paid', transactions: mapped };
    if (acct && new Date(acct.expires_at) < new Date()) return { status: 'expired', transactions: [] };
    return { status: 'pending', transactions: [] };
  }

  async verifyTransaction(providerReference: string): Promise<ProviderTransaction | null> {
    const row = await one(pool, `SELECT * FROM sandbox_provider_transactions WHERE reference=$1`, [providerReference]);
    return row ? toTxn(row) : null;
  }

  async processRefund(input: RefundInput): Promise<TransferResult> {
    const ref = `sbx_rf_${crypto.randomBytes(8).toString('hex')}`;
    const fail = (input.reason ?? '').toLowerCase().includes('fail');
    await pool.query(
      `INSERT INTO sandbox_provider_transactions (reference, kind, related_reference, amount, status, details) VALUES ($1,'refund',$2,$3,'processing',$4)`,
      [ref, input.reference, input.amount, JSON.stringify({ payment: input.paymentReference })],
    );
    await this.scheduleWebhook(fail ? 'refund.failed' : 'refund.successful', { reference: input.reference, provider_reference: ref, reason: fail ? 'Beneficiary account could not be credited' : undefined }, ref, fail);
    return { providerReference: ref, status: 'processing' };
  }

  async initiateSettlement(input: TransferInput): Promise<TransferResult> {
    const ref = `sbx_tr_${crypto.randomBytes(8).toString('hex')}`;
    const fail = input.accountNumber.endsWith('0000');
    await pool.query(
      `INSERT INTO sandbox_provider_transactions (reference, kind, account_number, related_reference, amount, status, details)
       VALUES ($1,'payout',$2,$3,$4,'processing',$5)`,
      [ref, input.accountNumber, input.reference, input.amount, JSON.stringify({ bankCode: input.bankCode, narration: input.narration })],
    );
    await this.scheduleWebhook(fail ? 'transfer.failed' : 'transfer.successful', { reference: input.reference, provider_reference: ref, reason: fail ? 'Destination bank declined the transfer' : undefined }, ref, fail);
    return { providerReference: ref, status: 'processing' };
  }

  async getBalance() {
    const row = await one<{ bal: number }>(
      pool,
      `SELECT COALESCE(SUM(CASE WHEN kind='collection' THEN amount ELSE -amount END) FILTER (WHERE status <> 'failed'),0) AS bal
         FROM sandbox_provider_transactions`,
    );
    return { available: row?.bal ?? 0, currency: 'NGN' as const };
  }

  async resolveAccount(_bankCode: string, accountNumber: string) {
    return { accountName: `SANDBOX ACCOUNT ${accountNumber.slice(-4)}` };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const rows = await query(pool, `SELECT * FROM sandbox_provider_transactions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at`, [from, to]);
    return rows.map(toTxn);
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    const sig = headers[SANDBOX_SIGNATURE_HEADER];
    if (!sig) return false;
    return safeEqual(sig, hmacSha512Hex(this.secret, rawBody));
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as { id: string; event: string; data: any };
    const d = body.data ?? {};
    switch (body.event) {
      case 'collection.successful':
      case 'collection.reversed': {
        const txn: ProviderTransaction = {
          providerReference: d.provider_reference, kind: body.event === 'collection.successful' ? 'collection' : 'reversal',
          amount: Number(d.amount), currency: 'NGN', accountNumber: d.account_number, relatedReference: d.related_reference ?? null,
          status: 'completed', payerName: d.payer_name ?? null, payerAccount: d.payer_account ?? null, payerBank: d.payer_bank ?? null,
          occurredAt: new Date(d.occurred_at), raw: d,
        };
        return { type: body.event === 'collection.successful' ? 'collection.received' : 'collection.reversed', externalId: body.id, transaction: txn };
      }
      case 'transfer.successful':
      case 'transfer.failed':
        return { type: body.event === 'transfer.successful' ? 'transfer.completed' : 'transfer.failed', externalId: body.id, reference: d.reference, providerReference: d.provider_reference, reason: d.reason };
      case 'refund.successful':
      case 'refund.failed':
        return { type: body.event === 'refund.successful' ? 'refund.completed' : 'refund.failed', externalId: body.id, reference: d.reference, providerReference: d.provider_reference, reason: d.reason };
      default:
        return { type: 'ignored', externalId: body.id, rawType: body.event };
    }
  }

  async healthCheck(): Promise<void> { await pool.query('SELECT 1'); }

  // ------------------------------------------------------------- sandbox-only helpers

  /** Build and sign a webhook body exactly as an external provider would. */
  signedWebhook(event: string, data: Record<string, unknown>, id = `sbx_evt_${crypto.randomBytes(10).toString('hex')}`) {
    const rawBody = JSON.stringify({ id, event, created_at: new Date().toISOString(), data });
    return { rawBody, headers: { [SANDBOX_SIGNATURE_HEADER]: hmacSha512Hex(this.secret, rawBody) } };
  }

  private async scheduleWebhook(event: string, data: Record<string, unknown>, ref: string, failed: boolean) {
    const { rawBody, headers } = this.signedWebhook(event, data);
    // Simulates the provider calling us back a moment later.
    await enqueue(pool, 'provider_webhook.process', { sandboxDelivery: { rawBody, headers, sandboxRef: ref, failed } }, { delayMs: 1500 });
  }

  /** Simulate a customer bank transfer into a sandbox account. */
  async simulateTransfer(accountNumber: string, amount: number, payer = { name: 'ADA OKAFOR', account: '0123456789', bank: 'Test Bank' }) {
    const ref = `sbx_tx_${crypto.randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO sandbox_provider_transactions (reference, kind, account_number, amount, status, payer_name, payer_account, payer_bank)
       VALUES ($1,'collection',$2,$3,'completed',$4,$5,$6)`,
      [ref, accountNumber, amount, payer.name, payer.account, payer.bank],
    );
    return this.signedWebhook('collection.successful', {
      provider_reference: ref, account_number: accountNumber, amount, currency: 'NGN', payer_name: payer.name,
      payer_account: payer.account, payer_bank: payer.bank, occurred_at: new Date().toISOString(),
    });
  }

  async simulateReversal(collectionRef: string) {
    const orig = await one(pool, `SELECT * FROM sandbox_provider_transactions WHERE reference=$1`, [collectionRef]);
    if (!orig) throw new Error('Unknown sandbox transaction');
    const ref = `sbx_rv_${crypto.randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO sandbox_provider_transactions (reference, kind, account_number, related_reference, amount, status) VALUES ($1,'reversal',$2,$3,$4,'completed')`,
      [ref, orig.account_number, collectionRef, orig.amount],
    );
    return this.signedWebhook('collection.reversed', {
      provider_reference: ref, related_reference: collectionRef, account_number: orig.account_number, amount: Number(orig.amount),
      occurred_at: new Date().toISOString(),
    });
  }

  /** Mark a sandbox payout/refund as settled (called when its webhook is delivered). */
  static async finalize(ref: string, failed: boolean) {
    await pool.query(`UPDATE sandbox_provider_transactions SET status=$2 WHERE reference=$1`, [ref, failed ? 'failed' : 'completed']);
  }
}

function toTxn(r: any): ProviderTransaction {
  return {
    providerReference: r.reference, kind: r.kind, amount: Number(r.amount), currency: 'NGN', accountNumber: r.account_number,
    relatedReference: r.related_reference, status: r.status, payerName: r.payer_name, payerAccount: r.payer_account,
    payerBank: r.payer_bank, occurredAt: new Date(r.created_at), raw: r.details ?? {},
  };
}
