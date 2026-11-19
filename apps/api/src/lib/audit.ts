import type { Db } from '../db/pool';

export interface Actor {
  type: 'user' | 'staff' | 'api_key' | 'system' | 'provider';
  id?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'system' };

/** Append-only audit trail. Called inside the same transaction as the change it records. */
export async function audit(
  db: Db,
  actor: Actor,
  action: string,
  opts: { organizationId?: string | null; targetType?: string; targetId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, organization_id, action, target_type, target_id, ip, user_agent, request_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      actor.type, actor.id ?? null, opts.organizationId ?? null, action, opts.targetType ?? null, opts.targetId ?? null,
      actor.ip ?? null, actor.userAgent?.slice(0, 300) ?? null, actor.requestId ?? null, JSON.stringify(opts.metadata ?? {}),
    ],
  );
}

export function actorLabel(actor: Actor): string {
  return `${actor.type}:${actor.id ?? 'unknown'}`;
}
