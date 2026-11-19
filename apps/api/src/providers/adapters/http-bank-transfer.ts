import { hmacSha512Hex, safeEqual } from '../../lib/crypto';
import type {
  PaymentProvider, ProviderContext, CreateAccountInput, CollectionAccount, PaymentStatusResult, ProviderTransaction,
  RefundInput, TransferInput, TransferResult, NormalizedWebhookEvent,
} from '../types';

/**
 * Configurable adapter for a licensed bank / PSP that offers dynamic virtual accounts and
 * transfers over a REST API. Configure in Admin → Providers:
 *   config:      { baseUrl, signatureHeader?, timeoutMs? }
 *   credentials: { secretKey, webhookSecret }
 *
 * INTEGRATION POINT: the request/response field mapping below follows a common shape used by
 * Nigerian virtual-account providers. Before going live, align each method with the chosen
 * provider's API reference and run it against their sandbox. Nothing outside this file needs
 * to change.
 */
export class HttpBankTransferProvider implements PaymentProvider {
  readonly adapter = 'http_bank_transfer';
  constructor(private readonly ctx: ProviderContext) {}

  private get baseUrl(): string {
    const url = String(this.ctx.config.baseUrl ?? '');
    if (!url.startsWith('https://')) throw new Error('Provider baseUrl must be configured with https://');
    return url.replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const secret = this.ctx.credentials.secretKey;
    if (!secret) throw new Error('Provider secretKey is not configured');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Number(this.ctx.config.timeoutMs ?? 15_000)),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Provider responded ${res.status}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createPaymentAccount(input: CreateAccountInput): Promise<CollectionAccount> {
    const r = await this.request<any>('POST', '/virtual-accounts', {
      reference: input.reference, amount: input.amount, currency: input.currency, customer_email: input.customerEmail,
      customer_name: input.customerName, account_name: input.merchantName, expires_at: input.expiresAt.toISOString(), single_use: true,
    });
    const d = r.data ?? r;
    return {
      providerReference: String(d.id ?? d.reference), bankName: String(d.bank_name), accountName: String(d.account_name),
      accountNumber: String(d.account_number), expiresAt: new Date(d.expires_at ?? input.expiresAt), raw: d,
    };
  }

  async getPaymentStatus(account: { providerReference: string }): Promise<PaymentStatusResult> {
    const r = await this.request<any>('GET', `/virtual-accounts/${encodeURIComponent(account.providerReference)}`);
    const d = r.data ?? r;
    const transactions = (d.transactions ?? []).map((t: any) => this.mapTxn(t));
    return { status: d.status === 'paid' ? 'paid' : d.status === 'expired' ? 'expired' : 'pending', transactions };
  }

  async verifyTransaction(providerReference: string): Promise<ProviderTransaction | null> {
    try {
      const r = await this.request<any>('GET', `/transactions/${encodeURIComponent(providerReference)}`);
      return this.mapTxn(r.data ?? r);
    } catch {
      return null;
    }
  }

  async processRefund(input: RefundInput): Promise<TransferResult> {
    const r = await this.request<any>('POST', '/refunds', {
      reference: input.reference, transaction_reference: input.collectionProviderReference, amount: input.amount, reason: input.reason,
    });
    const d = r.data ?? r;
    return { providerReference: String(d.id ?? d.reference), status: mapStatus(d.status) };
  }

  async initiateSettlement(input: TransferInput): Promise<TransferResult> {
    const r = await this.request<any>('POST', '/transfers', {
      reference: input.reference, amount: input.amount, currency: 'NGN', bank_code: input.bankCode,
      account_number: input.accountNumber, account_name: input.accountName, narration: input.narration,
    });
    const d = r.data ?? r;
    return { providerReference: String(d.id ?? d.reference), status: mapStatus(d.status), failureReason: d.failure_reason };
  }

  async getBalance() {
    const r = await this.request<any>('GET', '/balance');
    return { available: Number((r.data ?? r).available), currency: 'NGN' as const };
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const r = await this.request<any>('GET', `/banks/resolve?bank_code=${bankCode}&account_number=${accountNumber}`);
    return { accountName: String((r.data ?? r).account_name) };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransaction[]> {
    const r = await this.request<any>('GET', `/transactions?from=${from.toISOString()}&to=${to.toISOString()}`);
    return ((r.data ?? r).items ?? []).map((t: any) => this.mapTxn(t));
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
    const secret = this.ctx.credentials.webhookSecret;
    const header = String(this.ctx.config.signatureHeader ?? 'x-provider-signature').toLowerCase();
    const sig = headers[header];
    if (!secret || !sig) return false;
    return safeEqual(sig, hmacSha512Hex(secret, rawBody));
  }

  parseWebhook(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody);
    const id = String(body.id ?? body.event_id);
    const d = body.data ?? {};
    switch (body.event) {
      case 'collection.successful': return { type: 'collection.received', externalId: id, transaction: this.mapTxn({ ...d, kind: 'collection' }) };
      case 'collection.reversed': return { type: 'collection.reversed', externalId: id, transaction: this.mapTxn({ ...d, kind: 'reversal' }) };
      case 'transfer.successful': return { type: 'transfer.completed', externalId: id, reference: d.reference, providerReference: d.id };
      case 'transfer.failed': return { type: 'transfer.failed', externalId: id, reference: d.reference, providerReference: d.id, reason: d.reason };
      case 'refund.successful': return { type: 'refund.completed', externalId: id, reference: d.reference, providerReference: d.id };
      case 'refund.failed': return { type: 'refund.failed', externalId: id, reference: d.reference, providerReference: d.id, reason: d.reason };
      default: return { type: 'ignored', externalId: id, rawType: String(body.event) };
    }
  }

  async healthCheck(): Promise<void> { await this.request('GET', '/health'); }

  private mapTxn(t: any): ProviderTransaction {
    return {
      providerReference: String(t.id ?? t.reference), kind: t.kind ?? 'collection', amount: Number(t.amount), currency: 'NGN',
      accountNumber: t.account_number ?? null, relatedReference: t.related_reference ?? null, status: mapStatus(t.status),
      payerName: t.payer_name ?? null, payerAccount: t.payer_account ?? null, payerBank: t.payer_bank ?? null,
      occurredAt: new Date(t.occurred_at ?? t.created_at ?? Date.now()), raw: t,
    };
  }
}

function mapStatus(s: string): 'processing' | 'completed' | 'failed' {
  if (['success', 'successful', 'completed', 'paid'].includes(s)) return 'completed';
  if (['failed', 'reversed', 'declined'].includes(s)) return 'failed';
  return 'processing';
}
