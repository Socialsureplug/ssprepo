/**
 * Application errors carry a stable machine code, an HTTP status and a message that is
 * safe to show to end users. Unknown errors are never exposed to clients.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: unknown) => new AppError('validation_error', 'Some fields are invalid.', 422, details),
  unauthorized: (msg = 'Authentication required.') => new AppError('unauthorized', msg, 401),
  forbidden: (msg = 'You do not have permission to perform this action.') => new AppError('forbidden', msg, 403),
  notFound: (what = 'Resource') => new AppError('not_found', `${what} not found.`, 404),
  conflict: (msg: string) => new AppError('conflict', msg, 409),
  invalidApiKey: () => new AppError('invalid_api_key', 'Invalid API key. Check the key in your dashboard under Developers → API keys.', 401),
  insufficientBalance: () => new AppError('insufficient_balance', 'Insufficient available balance for this operation.', 422),
  merchantNotVerified: () =>
    new AppError('merchant_not_verified', 'Live payments are available after your business verification is approved.', 403),
  merchantRestricted: () =>
    new AppError('merchant_restricted', 'This account is restricted. Contact support to resolve this.', 403),
  providerUnavailable: () =>
    new AppError('provider_unavailable', 'Payment service is temporarily unavailable. Please try again shortly.', 503),
  invalidTransition: (from: string, to: string) =>
    new AppError('invalid_state_transition', `Cannot move from ${from} to ${to}.`, 409),
  rateLimited: () => new AppError('rate_limited', 'Too many requests. Please slow down and retry.', 429),
  idempotencyMismatch: () =>
    new AppError('idempotency_key_reused', 'This Idempotency-Key was already used with a different request body.', 422),
};
