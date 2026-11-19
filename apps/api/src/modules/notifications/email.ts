import { config } from '../../config';
import { logger } from '../../lib/logger';

/** Email delivery is behind an interface so the provider can be swapped by configuration. */
export interface EmailMessage { to: string; subject: string; text: string; html?: string; }
export interface EmailProvider { send(msg: EmailMessage): Promise<void>; }

class ConsoleEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    logger.info({ to: msg.to, subject: msg.subject }, `[email]\n${msg.text}`);
  }
}

/** Captures emails in memory; used by automated tests. */
export class MemoryEmailProvider implements EmailProvider {
  static outbox: EmailMessage[] = [];
  async send(msg: EmailMessage) { MemoryEmailProvider.outbox.push(msg); }
}

/** Generic JSON-over-HTTPS email API (most transactional email services accept this shape). */
class HttpEmailProvider implements EmailProvider {
  async send(msg: EmailMessage) {
    if (!config.EMAIL_HTTP_ENDPOINT || !config.EMAIL_HTTP_API_KEY) throw new Error('HTTP email provider not configured');
    const res = await fetch(config.EMAIL_HTTP_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.EMAIL_HTTP_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  }
}

let provider: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (!provider) {
    provider = config.EMAIL_PROVIDER === 'http' ? new HttpEmailProvider()
      : config.EMAIL_PROVIDER === 'memory' || config.isTest ? new MemoryEmailProvider() : new ConsoleEmailProvider();
  }
  return provider;
}
