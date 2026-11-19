import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';
import { useSubmit, formValues } from './forms';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/auth/login', { email: v.email, password: v.password });
    await qc.invalidateQueries({ queryKey: ['session'] });
    const next = params.get('next');
    navigate(next && next.startsWith('/dashboard') ? next : '/dashboard', { replace: true });
  });
  return (
    <AuthLayout title="Sign in" description="Welcome back. Sign in to your dashboard." footer={<>New here? <Link className="font-medium text-primary" to="/signup">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="flex justify-end"><Link to="/forgot-password" className="text-[13px] text-primary">Forgot password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}
