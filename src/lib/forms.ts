import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError, errorMessage } from './api';

/** Maps server-side validation errors onto form fields; anything else becomes a toast. */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown) {
  if (err instanceof ApiError && err.details?.fields) {
    for (const [field, message] of Object.entries(err.details.fields)) {
      form.setError(field as Path<T>, { message });
    }
    if (err.code !== 'VALIDATION_FAILED') toast.error(err.message);
    return;
  }
  toast.error(errorMessage(err));
}

/** Wraps an async action with success/error toasts. Rethrows so dialogs can stay open on failure. */
export async function withToast<T>(fn: () => Promise<T>, success: string | ((r: T) => string)): Promise<T> {
  try {
    const r = await fn();
    toast.success(typeof success === 'function' ? success(r) : success);
    return r;
  } catch (e) {
    toast.error(errorMessage(e));
    throw e;
  }
}
