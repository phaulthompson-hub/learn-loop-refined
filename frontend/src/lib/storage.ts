// localStorage wrappers that never throw (private windows and blocked storage just behave as empty).
const TOKEN_KEY = 'learnloop.token';

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value simply is not remembered.
  }
}

export const getToken = (): string | null => (typeof window === 'undefined' ? null : readStorage(TOKEN_KEY));
export const setToken = (token: string | null): void => writeStorage(TOKEN_KEY, token);

export function readJson<T>(key: string, fallback: T): T {
  const raw = readStorage(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const writeJson = (key: string, value: unknown): void => writeStorage(key, JSON.stringify(value));
