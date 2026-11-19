import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Errors } from '../lib/errors';
import type { Actor } from '../lib/audit';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Errors.validation(result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ status: 'success', data });
}

export function pagination(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function actorFrom(req: Request): Actor {
  const base = { ip: clientIp(req), userAgent: req.get('user-agent') ?? null, requestId: req.requestId };
  if (req.staff) return { type: 'staff', id: req.staff.user.id, ...base };
  if (req.session) return { type: 'user', id: req.session.user.id, ...base };
  if (req.apiKey) return { type: 'api_key', id: req.apiKey.apiKeyId, ...base };
  return { type: 'system', ...base };
}

/** Escape LIKE wildcards in user search input. */
export function likeTerm(s: string) {
  return `%${s.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
