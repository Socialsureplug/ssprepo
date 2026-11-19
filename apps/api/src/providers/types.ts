/**
 * Provider abstraction. The platform never moves money itself: every collection, refund and
 * payout is executed by a licensed provider (bank / PSP) behind this interface. Adding a new
 * provider means writing one adapter; nothing else in the codebase depends on provider specifics.
 *
 * Future payment methods (cards, USSD, QR) add new capability interfaces alongside
 * BankTransferCapability rather than changing this one.
 */
export interface CreateAccountInput {
  reference: string;
  amount: number;
  currency: 'NGN';
  customerEmail: string;
  customerName?: string | null;
  merchantName: string;
  expiresAt: Date;
}

export interface CollectionAccount {
  providerReference: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  expiresAt: Date;
  raw: Record<string, unknown>;
}

export interface ProviderTransaction {
  providerReference: string;
  kind: 'collection' | 'reversal' | 'refund' | 'payout';
  amount: number;
  currency: 'NGN';
  accountNumber?: string | null;
  /** For reversals/refunds/payouts: the provider reference of the related transaction or our own reference. */
  relatedReference?: string | null;
  status: 'processing' | 'completed' | 'failed';
  payerName?: string | null;
  payerAccount?: string | null;
  payerBank?: string | null;
  occurredAt: Date;
  raw: Record<string, unknown>;
}

export interface PaymentStatusResult {
  status: 'pending' | 'paid' | 'expired';
  transactions: ProviderTransaction[];
}

export interface TransferInput {
  reference: string;
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration: string;
}

export interface TransferResult { providerReference: string; status: 'processing' | 'completed' | 'failed'; failureReason?: string; }

export interface RefundInput {
  reference: string;
  paymentReference: string;
  collectionProviderReference: string;
  amount: number;
  reason?: string | null;
}

export type NormalizedWebhookEvent =
  | { type: 'collection.received'; externalId: string; transaction: ProviderTransaction }
  | { type: 'collection.reversed'; externalId: string; transaction: ProviderTransaction }
  | { type: 'transfer.completed' | 'transfer.failed'; externalId: string; reference: string; providerReference: string; reason?: string }
  | { type: 'refund.completed' | 'refund.failed'; externalId: string; reference: string; providerReference: string; reason?: string }
  | { type: 'ignored'; externalId: string; rawType: string };

export interface PaymentProvider {
  readonly adapter: string;
  createPaymentAccount(input: CreateAccountInput): Promise<CollectionAccount>;
  getPaymentStatus(account: { providerReference: string; accountNumber: string }): Promise<PaymentStatusResult>;
  verifyTransaction(providerReference: string): Promise<ProviderTransaction | null>;
  processRefund(input: RefundInput): Promise<TransferResult>;
  initiateSettlement(input: TransferInput): Promise<TransferResult>;
  getBalance(): Promise<{ available: number; currency: 'NGN' }>;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string }>;
  listTransactions(from: Date, to: Date): Promise<ProviderTransaction[]>;
  /** Verify authenticity of an incoming webhook from the raw request body. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Parse a verified webhook into a normalized event (handleWebhook in the spec). */
  parseWebhook(rawBody: string): NormalizedWebhookEvent;
  healthCheck(): Promise<void>;
}

export interface ProviderContext {
  providerId: string;
  code: string;
  credentials: Record<string, string>;
  config: Record<string, unknown>;
}
