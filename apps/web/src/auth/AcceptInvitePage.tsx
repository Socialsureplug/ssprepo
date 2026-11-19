import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Spinner } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';
import { useSubmit, formValues } from './forms';

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ valid: boolean; organizationName?: string; email?: string; hasAccount?: boolean }>(`/auth/invites/${encodeURIComponent(token)}`), enabled: !!token });
  const { submit, loading, error, fieldErrors } = useSubmit(async (v: Record<string, string>) => {
    await api.post('/auth/invites/accept', { token, ...v });
    await qc.invalidateQueries({ queryKey: ['session'] });
    navigate('/dashboard', { replace: true });
  });

  if (invite.isLoading) return <AuthLayout title="Join your team"><Spinner /></AuthLayout>;
  if (!token || !invite.data?.valid) {
    return <AuthLayout title="Invitation unavailable"><Alert tone="warning">This invitation is invalid or has expired. Ask your team owner to send a new one.</Alert></AuthLayout>;
  }
  const { organizationName, email, hasAccount } = invite.data;
  return (
    <AuthLayout title={`Join ${organizationName}`} description={`You were invited as ${email}.`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(formValues(e.currentTarget)); }} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {!hasAccount && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="firstName"><Input id="firstName" name="firstName" required /></Field>
            <Field label="Last name" htmlFor="lastName"><Input id="lastName" name="lastName" required /></Field>
          </div>
        )}
        <Field label={hasAccount ? 'Your password' : 'Create a password'} htmlFor="password" error={fieldErrors.password}
          hint={hasAccount ? 'Confirm it is you by entering your existing password.' : 'At least 10 characters, with a letter and a number.'}>
          <Input id="password" name="password" type="password" autoComplete={hasAccount ? 'current-password' : 'new-password'} required />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>Accept invitation</Button>
      </form>
    </AuthLayout>
  );
}
