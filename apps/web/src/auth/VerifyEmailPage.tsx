import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, buttonVariants, Spinner } from '@app/ui';
import { api } from '../lib/api';
import { AuthLayout } from './AuthLayout';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) { setState('error'); setMessage('This verification link is incomplete.'); return; }
    api.post('/auth/verify-email', { token })
      .then(() => { setState('ok'); void qc.invalidateQueries({ queryKey: ['session'] }); })
      .catch((e) => { setState('error'); setMessage(e.message); });
  }, [params, qc]);
  return (
    <AuthLayout title="Verify your email">
      {state === 'loading' && <Spinner />}
      {state === 'ok' && (
        <div className="space-y-6">
          <Alert tone="success" title="Email verified">Your email address is confirmed.</Alert>
          <Link to="/dashboard" className={buttonVariants({ className: 'w-full', size: 'lg' })}>Continue to dashboard</Link>
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-6">
          <Alert tone="danger" title="We couldn't verify your email">{message} Sign in and request a new link from your dashboard.</Alert>
          <Link to="/login" className={buttonVariants({ variant: 'secondary', className: 'w-full' })}>Go to sign in</Link>
        </div>
      )}
    </AuthLayout>
  );
}
