import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Logo } from '@app/ui';
import { api } from '../lib';

export default function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-5">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-pop">
        <Logo suffix="Admin" />
        <h1 className="mt-8 font-serif text-[34px] leading-tight">Staff sign in</h1>
        <p className="mt-1 text-[13.5px] text-muted">Restricted to authorised platform staff. Access is logged.</p>
        <form className="mt-6 space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setLoading(true); setError(null);
          try {
            await api.post('/admin/auth/login', { email: f.get('email'), password: f.get('password') });
            await qc.invalidateQueries({ queryKey: ['staff-session'] });
            navigate('/', { replace: true });
          } catch (err: any) { setError(err.message); } finally { setLoading(false); }
        }}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
          <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
          <Button type="submit" className="w-full" loading={loading}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}
