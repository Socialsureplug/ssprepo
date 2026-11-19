import { useState } from 'react';
import { ApiError } from '@app/ui';

/** Small form-state helper: submit handler with loading, top-level error and per-field errors. */
export function useSubmit<T>(fn: (values: T) => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submit = async (values: T) => {
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn(values);
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors());
        setError(e.code === 'validation_error' ? 'Please correct the highlighted fields.' : e.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };
  return { submit, loading, error, fieldErrors, setError };
}

export function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}
