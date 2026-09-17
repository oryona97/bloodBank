import type { ApiErrorBody } from '../../shared/apiTypes.js';
let csrfToken = '';
let generation = 0;
export function setSessionToken(token: string) {
  csrfToken = token;
  generation++;
}
export class ApiError extends Error {
  constructor(
    public body: ApiErrorBody,
    public status: number,
  ) {
    super(body.error);
  }
}
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const started = generation;
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Requested-With': 'BloodBank',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (started !== generation) throw new Error('Account changed. Please retry.');
  if (response.status === 401 && path !== '/auth/login' && csrfToken)
    window.dispatchEvent(new Event('session-expired'));
  if (!response.ok) throw new ApiError(result as ApiErrorBody, response.status);
  window.dispatchEvent(new Event('session-activity'));
  return result as T;
}
