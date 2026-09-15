import type { ApiErrorBody } from '../../shared/apiTypes.js';
export class ApiError extends Error {
  constructor(
    public body: ApiErrorBody,
    public status: number,
  ) {
    super(body.error);
  }
}
export async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new ApiError(result as ApiErrorBody, response.status);
  return result as T;
}
