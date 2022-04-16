import { afterEach } from 'vitest';

// Unmount React trees between component tests (only relevant for files that opt into jsdom).
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  window.localStorage?.clear();
});
