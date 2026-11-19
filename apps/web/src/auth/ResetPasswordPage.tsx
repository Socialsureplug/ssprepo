import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Input, buttonVariants } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';
import { useSubmit, formValues } from './forms';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const { submit, loading, error, fieldErrors, setError } = useSubmit(async (v: Record<string, string>) => {
    if (v.password !== v.confirm) { setError('Passwords do not match.'); return; }
    await api.post('/auth/reset-password', { token: params.get('token') ?? '', password: v.password });
    setDone(true);
  });
  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <div className="space-y-6">
          <Alert tone="success" title="Password updated">For your security, all existing sessions were signed out.</Alert>
          <Link to="/login" className={buttonVariants({ className: 'w-full', size: 'lg' })}>Sign in</Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters, with a letter and a number.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
          <Button type="submit" className="w-full" size="lg" loading={loading}>Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}
