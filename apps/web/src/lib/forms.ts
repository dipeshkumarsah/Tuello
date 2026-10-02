import { createTranslator } from '@tuello/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

const t = createTranslator('en');

/** Maps a problem response onto form fields; returns a form-level message for the rest. */
export function applyProblem<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): string {
  if (err instanceof ApiError) {
    for (const [path, message] of Object.entries(err.fieldErrors())) {
      if (path) setError(path as Path<T>, { message });
    }
    return err.problem.detail ?? err.problem.title;
  }
  return t('problem.internal_error');
}

/** Zod issue messages are i18n keys ("validation.email"); translate them for display. */
export function fieldMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message.startsWith('validation.') ? t(message) : message;
}
