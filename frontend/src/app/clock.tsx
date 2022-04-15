import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { http } from '../lib/http';
import { parseDate } from '../lib/dates';
import type { Meta } from './types';

type ClockState = { now: Date; frozen: boolean; aiMode: string; version: string };

const ClockContext = createContext<ClockState>({ now: new Date(), frozen: false, aiMode: 'demo', version: '' });

/**
 * "Now" comes from the API (`/meta`), not the browser. With FROZEN_NOW set on the server every page
 * (calendar month, due dates, "3 days ago") renders identically regardless of when it is opened.
 * When the server clock is live we keep it ticking locally, offset-corrected, once a minute.
 */
export function ClockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClockState & { offset: number }>({
    now: new Date(),
    frozen: false,
    aiMode: 'demo',
    version: '',
    offset: 0,
  });

  useEffect(() => {
    let cancelled = false;
    http
      .get<Meta>('/meta')
      .then((meta) => {
        if (cancelled) return;
        const server = parseDate(meta.now);
        setState({ now: server, frozen: meta.frozen, aiMode: meta.ai_mode, version: meta.version, offset: server.getTime() - Date.now() });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.frozen) return;
    const timer = window.setInterval(() => setState((s) => ({ ...s, now: new Date(Date.now() + s.offset) })), 60_000);
    return () => window.clearInterval(timer);
  }, [state.frozen]);

  return <ClockContext.Provider value={state}>{children}</ClockContext.Provider>;
}

export const useClock = () => useContext(ClockContext);
export const useNow = () => useContext(ClockContext).now;
