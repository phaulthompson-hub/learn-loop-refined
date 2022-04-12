// Single HTTP entry point: base URL, bearer token, JSON encoding and FastAPI error parsing.
import { getToken } from './storage';

export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ValidationIssue = { loc?: (string | number)[]; msg?: string };

/** Turn a FastAPI error body (`{detail: string}` or `{detail: ValidationIssue[]}`) into one readable sentence. */
export function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    return (detail as ValidationIssue[])
      .map((issue) => {
        const field = issue.loc?.filter((part) => part !== 'body' && part !== 'query').join('.');
        const msg = (issue.msg ?? 'is invalid').replace(/^Value error, /, '');
        return field ? `${field}: ${msg}` : msg;
      })
      .join('; ');
  }
  if (status === 0) return 'Cannot reach the LearnLoop API. Is the backend running?';
  return `Request failed (${status})`;
}

/** Listeners notified when the API answers 401, so the app can drop a stale session. */
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function request<T>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(errorMessage(null, 0), 0);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && token) unauthorizedListeners.forEach((listener) => listener());
    throw new ApiError(errorMessage(body, response.status), response.status);
  }
  return body as T;
}

export const jsonBody = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

type QueryValue = string | number | boolean | null | undefined | (string | number)[];

/** Build `?a=1&b=x` from an object, skipping empty values, so list filters map directly onto query params. */
export function query(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, data === undefined ? { method: 'POST' } : jsonBody('POST', data)),
  put: <T>(path: string, data?: unknown) => request<T>(path, data === undefined ? { method: 'PUT' } : jsonBody('PUT', data)),
  patch: <T>(path: string, data: unknown) => request<T>(path, jsonBody('PATCH', data)),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
