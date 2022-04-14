import { useCallback, useEffect, useRef, useState } from 'react';

export type Loader<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Replace the loaded data locally (e.g. after a mutation returned the new version) without refetching. */
  mutate: (update: (current: T) => T) => void;
};

type Settled<T> = { key: string; token: string; data: T | null; error: string | null };

/**
 * Load data whenever `key` changes (e.g. `course:3`), exposing loading and error state plus a manual reload.
 * Data from a previous key is never returned, so pages cannot briefly render the wrong course.
 */
export function useLoader<T>(load: () => Promise<T>, key: string): Loader<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    const token = `${key}#${version}`;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setSettled({ key, token, data, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err.message : String(err);
        setSettled((previous) => ({ key, token, data: previous?.key === key ? previous.data : null, error }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const mutate = useCallback(
    (update: (current: T) => T) =>
      setSettled((previous) => (previous?.data == null ? previous : { ...previous, data: update(previous.data), error: null })),
    [],
  );
  const current = settled?.key === key ? settled : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current?.token !== `${key}#${version}`,
    reload,
    mutate,
  };
}
