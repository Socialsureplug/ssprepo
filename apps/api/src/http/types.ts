import type { Mode, MerchantRole, StaffRole } from '@app/shared';
import type { OrgRow } from '../modules/organizations/org.repo';

export interface SessionContext {
  sessionId: string;
  csrfToken: string;
  user: { id: string; email: string; first_name: string; last_name: string; email_verified_at: Date | null; staff_roles: StaffRole[] };
  org: OrgRow | null;
  role: MerchantRole | null;
  mode: Mode;
}

export interface ApiKeyContext { apiKeyId: string; org: OrgRow; mode: Mode; }

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    rawBody?: string;
    session?: SessionContext;
    staff?: SessionContext;
    apiKey?: ApiKeyContext;
  }
}
