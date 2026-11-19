import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';
import { useSubmit, formValues } from './forms';

export default function SignupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/auth/signup', v);
    await qc.invalidateQueries({ queryKey: ['session'] });
    navigate('/dashboard/onboarding', { replace: true });
  });
  return (
    <AuthLayout
      title="Create your account"
      description="Start in test mode right away. Go live once your business is verified."
      footer={<>Already have an account? <Link className="font-medium text-primary" to="/login">Sign in</Link></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="firstName" error={fieldErrors.firstName}><Input id="firstName" name="firstName" autoComplete="given-name" required /></Field>
          <Field label="Last name" htmlFor="lastName" error={fieldErrors.lastName}><Input id="lastName" name="lastName" autoComplete="family-name" required /></Field>
        </div>
        <Field label="Business name" htmlFor="businessName" error={fieldErrors.businessName}><Input id="businessName" name="businessName" autoComplete="organization" required /></Field>
        <Field label="Work email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters, with a letter and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>Create account</Button>
        <p className="text-center text-[12.5px] text-muted">By creating an account you agree to our terms of service and privacy policy.</p>
      </form>
    </AuthLayout>
  );
}
