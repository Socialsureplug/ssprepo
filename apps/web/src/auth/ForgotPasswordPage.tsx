import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field, Input } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';
import { useSubmit, formValues } from './forms';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/auth/forgot-password', { email: v.email });
    setSent(true);
  });
  return (
    <AuthLayout title="Reset your password" description="Enter your account email and we'll send you a link to choose a new password." footer={<Link className="font-medium text-primary" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for that email, a reset link is on its way. The link expires in 30 minutes.</Alert>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" autoComplete="email" required autoFocus /></Field>
          <Button type="submit" className="w-full" size="lg" loading={loading}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
