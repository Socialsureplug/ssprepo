import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { MerchantSession, MerchantPermission } from '@app/shared';
import { Spinner } from '@app/ui';
import { api } from './api';

type Session = MerchantSession & { permissions: MerchantPermission[] };

const SessionContext = React.createContext<{ session: Session; refresh: () => Promise<void> } | null>(null);

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const s = await api.get<Session>('/auth/me');
        api.setCsrf(s.csrfToken);
        return s;
      } catch (e: any) {
        if (e?.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

/** Route guard: renders children only for an authenticated merchant user. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const q = useSessionQuery();
  const qc = useQueryClient();
  const location = useLocation();
  if (q.isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!q.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  const refresh = async () => { await qc.invalidateQueries(); };
  return <SessionContext.Provider value={{ session: q.data, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside RequireSession');
  return ctx;
}

export function useCan(permission: MerchantPermission) {
  return useSession().session.permissions.includes(permission);
}
