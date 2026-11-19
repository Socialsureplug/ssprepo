import * as React from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { StaffPermission, StaffRole } from '@app/shared';
import { createClient, Spinner, Alert, Button } from '@app/ui';

export const api = createClient(import.meta.env.VITE_API_URL ?? '/api');

export interface StaffSession {
  user: { id: string; email: string; firstName: string; lastName: string };
  roles: StaffRole[]; permissions: StaffPermission[]; csrfToken: string;
}

const Ctx = React.createContext<{ session: StaffSession; mode: 'test' | 'live'; setMode: (m: 'test' | 'live') => void } | null>(null);

export function useStaffSessionQuery() {
  return useQuery({
    queryKey: ['staff-session'],
    queryFn: async () => {
      try {
        const s = await api.get<StaffSession>('/admin/auth/me');
        api.setCsrf(s.csrfToken);
        return s;
      } catch (e: any) {
        if (e?.status === 401) return null;
        throw e;
      }
    },
  });
}

export function RequireStaff({ children }: { children: React.ReactNode }) {
  const q = useStaffSessionQuery();
  const location = useLocation();
  const [mode, setMode] = React.useState<'test' | 'live'>(() => (localStorageGet('admin-mode') === 'test' ? 'test' : 'live'));
  if (q.isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!q.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  const set = (m: 'test' | 'live') => { setMode(m); localStorageSet('admin-mode', m); };
  return <Ctx.Provider value={{ session: q.data, mode, setMode: set }}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useStaff outside RequireStaff');
  return c;
}

export function useCan(p: StaffPermission) {
  return useStaff().session.permissions.includes(p);
}

/** Admin data hook; the selected data mode (live/test) is part of every key. */
export function useAdminQuery<T>(key: unknown[], path: string, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  const { mode } = useStaff();
  const sep = path.includes('?') ? '&' : '?';
  return useQuery({ queryKey: [mode, ...key], queryFn: () => api.get<T>(`${path}${sep}mode=${mode}`), ...opts });
}

export function useAdminMutation<TVars>(fn: (v: TVars) => Promise<unknown>, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: async () => { await qc.invalidateQueries(); onDone?.(); } });
}

export function Forbidden() {
  return <Alert tone="warning" title="Not available for your role">Your admin role does not include access to this area. Ask a super admin if you need it.</Alert>;
}

export function LoadError({ error, retry }: { error: Error; retry?: () => void }) {
  return <Alert tone="danger" title="Could not load data" action={retry && <Button size="sm" variant="secondary" onClick={retry}>Retry</Button>}>{error.message}</Alert>;
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
