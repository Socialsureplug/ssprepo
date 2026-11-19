/**
 * Minimal typed API client shared by the web and admin apps. Cookies carry the session;
 * the CSRF token from the session bootstrap is attached to every state-changing request.
 */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: { field: string; message: string }[], public requestId?: string) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.field, d.message]));
  }
}

export function createClient(baseUrl: string) {
  let csrfToken = '';
  const setCsrf = (t: string) => { csrfToken = t; };

  async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network_error', 'We could not reach the server. Check your connection and try again.', 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.status === 'error') {
      const e = json?.error ?? {};
      throw new ApiError(e.code ?? 'error', e.message ?? 'Something went wrong. Please try again.', res.status, Array.isArray(e.details) ? e.details : undefined, e.requestId);
    }
    return (json?.data ?? json) as T;
  }

  return {
    setCsrf,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, headers),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    del: <T>(path: string) => request<T>('DELETE', path),
  };
}

export function newIdempotencyKey() {
  return `idem_${crypto.randomUUID()}`;
}

export function formatDate(d: string | Date | null | undefined, opts: { time?: boolean } = { time: true }) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', ...(opts.time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function relativeTime(d: string | Date) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDate(d, { time: false });
}

/** Convert a naira string typed by a user into kobo, or null if invalid. */
export function nairaToKobo(input: string): number | null {
  const clean = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [w, f = ''] = clean.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}
