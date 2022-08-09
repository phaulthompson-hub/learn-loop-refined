import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { cx } from '../../lib/cx';
import { toApiDateTime } from '../../lib/dates';
import { relativeTime } from '../../lib/format';
import { notificationsApi } from './api';
import { NotificationIcon } from './NotificationIcon';
import { badgeText, bellLabel, isInternalLink, withAllRead, withRead } from './notificationLogic';
import type { AppNotification } from './types';
import './notifications.css';

const LATEST = 8;

/** Top-bar bell with the unread count and a dropdown of recent notifications. */
export function NotificationBell() {
  const { me, setUnread } = useAuth();
  const unread = me?.unread_notifications ?? 0;
  const now = useNow();
  const navigate = useNavigate();
  const toast = useToast();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const load = async () => {
    setError(null);
    try {
      const page = await notificationsApi.list({ limit: LATEST });
      setItems(page.items);
      setUnread(page.unread);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications');
    }
  };

  const toggle = () => {
    if (!open) void load();
    setOpen(!open);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // Handled on the root so arrows and Escape also work while focus is still on the bell button.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const entries = [...(list.current?.querySelectorAll<HTMLElement>('[data-notification]') ?? [])];
    if (!entries.length) return;
    event.preventDefault();
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    entries[(next + entries.length) % entries.length].focus();
  };

  const openItem = async (item: AppNotification) => {
    close(false);
    if (!item.read) {
      setItems((current) => current && withRead(current, item.id, true, toApiDateTime(now)));
      setUnread(Math.max(0, unread - 1));
      notificationsApi.setRead(item.id, true).catch((err: Error) => toast.error(err.message));
    }
    if (isInternalLink(item.link)) navigate(item.link);
  };

  const markAllRead = async () => {
    try {
      const result = await notificationsApi.markAllRead();
      setItems((current) => current && withAllRead(current, toApiDateTime(now)));
      setUnread(result.unread);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark notifications as read');
    }
  };

  const badge = badgeText(unread);
  return (
    <div className="bell-root" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={button}
        className={cx('icon-only bell-button', badge && 'has-unread')}
        aria-label={bellLabel(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <Bell />
        {badge && (
          <span className="bell-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} className="bell-panel" role="dialog" aria-label="Notifications">
          <header className="bell-head">
            <b>Notifications</b>
            <button type="button" className="ghost small" onClick={markAllRead} disabled={unread === 0}>
              <Check /> Mark all read
            </button>
          </header>
          {error ? (
            <div className="bell-state">
              <p>{error}</p>
              <button type="button" className="secondary small" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : items === null ? (
            <div className="bell-state" role="status">
              <Loader2 className="spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="bell-state">
              <Bell />
              <p>You&rsquo;re all caught up.</p>
            </div>
          ) : (
            <ul className="bell-list" ref={list}>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" data-notification className={cx('bell-item', !item.read && 'unread')} onClick={() => void openItem(item)}>
                    <NotificationIcon kind={item.kind} />
                    <span className="bell-text">
                      <b>{item.title}</b>
                      {item.body && <span className="bell-body">{item.body}</span>}
                      <small>
                        {relativeTime(item.created_at, now)}
                        {item.workspace && ` · ${item.workspace.name}`}
                      </small>
                    </span>
                    {!item.read && (
                      <span className="unread-dot">
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link className="bell-foot" to="/notifications" onClick={() => close(false)}>
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
