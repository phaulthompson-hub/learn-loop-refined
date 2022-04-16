import { describe, expect, it, vi } from 'vitest';
import { API_URL, ApiError, errorMessage, onUnauthorized, query, request } from './http';

const response = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('errorMessage', () => {
  it('uses a plain FastAPI detail string', () => {
    expect(errorMessage({ detail: 'Course not found' }, 404)).toBe('Course not found');
  });

  it('flattens pydantic validation errors into readable text', () => {
    const body = {
      detail: [
        { loc: ['body', 'title'], msg: 'String should have at least 2 characters' },
        { loc: ['body', 'text'], msg: 'Value error, must not be blank' },
      ],
    };
    expect(errorMessage(body, 422)).toBe('title: String should have at least 2 characters; text: must not be blank');
  });

  it('drops the query prefix from parameter errors', () => {
    expect(errorMessage({ detail: [{ loc: ['query', 'page'], msg: 'must be positive' }] }, 422)).toBe('page: must be positive');
  });

  it('explains network failures and unknown errors', () => {
    expect(errorMessage(null, 0)).toMatch(/Cannot reach the LearnLoop API/);
    expect(errorMessage({}, 500)).toBe('Request failed (500)');
  });
});

describe('request', () => {
  it('prefixes the API URL and returns JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true }));
    await expect(request('/meta', {}, fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API_URL}/meta`);
  });

  it('returns undefined for 204 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(request('/courses/1', { method: 'DELETE' }, fetchImpl)).resolves.toBeUndefined();
  });

  it('throws ApiError with status and server message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(400, { detail: 'Invalid question' }));
    const error = await request('/courses/1/answers', {}, fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'Invalid question' });
  });

  it('wraps network failures as status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('/meta', {}, fetchImpl)).rejects.toMatchObject({ status: 0 });
  });

  it('handles error bodies that are not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    await expect(request('/meta', {}, fetchImpl)).rejects.toMatchObject({ message: 'Request failed (502)' });
  });

  it('does not fire unauthorized listeners when no token was sent', async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { detail: 'Sign in to continue' }));
    await expect(request('/auth/me', {}, fetchImpl)).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

describe('query', () => {
  it('skips empty values and repeats arrays', () => {
    expect(query({ q: 'sql', page: 2, status: '', tag: undefined, ids: [1, 2], mine: false })).toBe('?q=sql&page=2&ids=1&ids=2&mine=false');
  });

  it('returns an empty string when nothing is set', () => {
    expect(query({ q: '', page: null })).toBe('');
  });
});
