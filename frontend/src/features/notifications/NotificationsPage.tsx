import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BellOff, Check, Inbox as InboxIcon, Loader2, Mail, MailOpen, Trash2 } from 'lucide-react';
import { useAuth } from '../../app/auth';
import { useNow } from '../../app/clock';
import { useToast } from '../../app/toast';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog } from '../../components/Modal';
import { Tabs } from '../../components/Tabs';
import { EmptyState, ErrorBanner, PageHeader } from '../../components/ui';
import { useLoader } from '../../hooks/useLoader';
import { cx } from '../../lib/cx';
import { toApiDateTime } from '../../lib/dates';
import { formatNumber, formatTime, plural } from '../../lib/format';
import { groupByDay } from '../home/activityLogic';
import { notificationsApi, type NotificationFilters } from './api';
import { NotificationIcon } from './NotificationIcon';
import { isInternalLink, isKind, KIND_META, KINDS, withAllRead, withoutIds, withRead } from './notificationLogic';
import type { AppNotification, NotificationKind, NotificationPage } from './types';
import './notifications.css';

const PAGE_SIZE = 20;
type View = 'all' | 'unread';

/** The full inbox: All/Unread tabs, kind filter, per-item read toggle and delete, and bulk actions. */
export function NotificationsPage() {
  const { me } = useAuth();
  const [search, setSearch] = useSearchParams();
  const view: View = search.get('view') === 'unread' ? 'unread' : 'all';
  const kindParam = search.get('kind');
  const kind = isKind(kindParam) ? kindParam : null;
  const filters: NotificationFilters = { unread: view === 'unread', kind, limit: PAGE_SIZE };
  const key = `notifications:${view}:${kind ?? ''}`;
  const { data, error, reload } = useLoader(() => notificationsApi.list(filters), key);
  const unread = me?.unread_notifications ?? 0;

  const update = (patch: { view?: View; kind?: NotificationKind | null }) => {
    const next = new URLSearchParams(search);
    const nextView = patch.view ?? view;
    const nextKind = patch.kind === undefined ? kind : patch.kind;
    if (nextView === 'unread') next.set('view', 'unread');
    else next.delete('view');
    if (nextKind) next.set('kind', nextKind);
    else next.delete('kind');
    setSearch(next, { replace: true });
  };

  return (
    <div className="notifications-page">
      <PageHeader eyebrow="Inbox" title="Notifications" subtitle="Reviews that are due, work assigned to you, mentions and milestones." />
      <div className="inbox-controls">
        <Tabs
          label="Show"
          value={view}
          onChange={(value) => update({ view: value })}
          items={[
            { key: 'all', label: 'All' },
            { key: 'unread', label: 'Unread', count: unread },
          ]}
        />
        <div className="kind-chips" role="group" aria-label="Filter by type">
          <button type="button" className={cx('kind-chip', kind === null && 'active')} aria-pressed={kind === null} onClick={() => update({ kind: null })}>
            All types
          </button>
          {KINDS.map((k) => {
            const count = data?.kinds[k] ?? 0;
            if (!count && kind !== k) return null;
            return (
              <button key={k} type="button" className={cx('kind-chip', `tone-${KIND_META[k].tone}`, kind === k && 'active')} aria-pressed={kind === k} onClick={() => update({ kind: kind === k ? null : k })}>
                {KIND_META[k].label}
                <span className="count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data ? <Inbox key={key} first={data} filters={filters} view={view} filtered={kind !== null} /> : !error && <InboxSkeleton />}
    </div>
  );
}

type InboxProps = { first: NotificationPage; filters: NotificationFilters; view: View; filtered: boolean };

/** Keyed by the filters: holds the loaded pages and applies read/delete changes locally. */
function Inbox({ first, filters, view, filtered }: InboxProps) {
  const { me, setUnread } = useAuth();
  const unread = me?.unread_notifications ?? first.unread;
  const now = useNow();
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(first.items);
  const [total, setTotal] = useState(first.total);
  const [cursor, setCursor] = useState(first.next_before_id);
  const [busy, setBusy] = useState<'more' | 'read-all' | 'clear' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const stamp = toApiDateTime(now);

  const fail = (err: unknown, fallback: string) => toast.error(err instanceof Error ? err.message : fallback);

  const toggleRead = async (item: AppNotification) => {
    const read = !item.read;
    setItems((current) => withRead(current, item.id, read, stamp));
    setUnread(Math.max(0, unread + (read ? -1 : 1)));
    try {
      await notificationsApi.setRead(item.id, read);
    } catch (err) {
      setItems((current) => withRead(current, item.id, !read, stamp));
      setUnread(unread);
      fail(err, 'Could not update the notification');
    }
  };

  const open = (item: AppNotification) => {
    if (!item.read) void toggleRead(item);
    if (isInternalLink(item.link)) navigate(item.link);
  };

  const remove = async (item: AppNotification) => {
    try {
      await notificationsApi.remove(item.id);
      setItems((current) => withoutIds(current, new Set([item.id])));
      setTotal((t) => t - 1);
      if (!item.read) setUnread(Math.max(0, unread - 1));
      toast.success('Notification deleted');
    } catch (err) {
      fail(err, 'Could not delete the notification');
    }
  };

  const markAllRead = async () => {
    setBusy('read-all');
    try {
      const result = await notificationsApi.markAllRead();
      setItems((current) => withAllRead(current, stamp));
      setUnread(result.unread);
      toast.success(result.changed ? `Marked ${plural(result.changed, 'notification')} as read` : 'Everything was already read');
    } catch (err) {
      fail(err, 'Could not mark notifications as read');
    } finally {
      setBusy(null);
    }
  };

  const clearRead = async () => {
    setBusy('clear');
    try {
      const result = await notificationsApi.clearRead();
      const cleared = new Set(items.filter((i) => i.read).map((i) => i.id));
      setItems((current) => withoutIds(current, cleared));
      setTotal((t) => Math.max(0, t - cleared.size));
      setUnread(result.unread);
      toast.success(`Cleared ${plural(result.changed, 'read notification')}`);
    } catch (err) {
      fail(err, 'Could not clear notifications');
    } finally {
      setBusy(null);
      setConfirmClear(false);
    }
  };

  const loadMore = async () => {
    if (cursor === null) return;
    setBusy('more');
    try {
      const page = await notificationsApi.list({ ...filters, before_id: cursor });
      setItems((current) => [...current, ...page.items.filter((p) => !current.some((c) => c.id === p.id))]);
      setCursor(page.next_before_id);
    } catch (err) {
      fail(err, 'Could not load older notifications');
    } finally {
      setBusy(null);
    }
  };

  const readCount = items.filter((i) => i.read).length;
  return (
    <>
      <div className="inbox-toolbar">
        <span className="muted">
          {total ? `Showing ${formatNumber(items.length)} of ${formatNumber(total)}` : 'Nothing here'}
          {unread > 0 && ` · ${plural(unread, 'unread notification')} in total`}
        </span>
        <div className="actions">
          <button type="button" className="secondary small" onClick={markAllRead} disabled={unread === 0 || busy !== null}>
            <Check /> Mark all read
          </button>
          <button type="button" className="ghost small" onClick={() => setConfirmClear(true)} disabled={view === 'unread' || readCount === 0 || busy !== null}>
            <Trash2 /> Clear read
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={view === 'unread' ? <BellOff /> : <InboxIcon />} title={view === 'unread' ? 'You’re all caught up' : 'No notifications'}>
          <p>
            {filtered
              ? 'Nothing of this type yet. Choose another type to see more.'
              : 'Due reviews, tasks assigned to you, mentions and milestones will appear here.'}
          </p>
          {view === 'unread' && (
            <Link className="secondary" to="/notifications">
              Show all notifications
            </Link>
          )}
        </EmptyState>
      ) : (
        groupByDay(items, now).map((group) => (
          <section key={group.key} className="inbox-day" aria-labelledby={`inbox-${group.key}`}>
            <h2 id={`inbox-${group.key}`} className="feed-day-title">
              {group.label}
            </h2>
            <ul className="inbox-list panel">
              {group.items.map((item) => (
                <li key={item.id} className={cx('inbox-item', !item.read && 'unread')}>
                  <NotificationIcon kind={item.kind} />
                  <div className="inbox-text">
                    <button type="button" className="inbox-title" onClick={() => open(item)}>
                      {item.title}
                    </button>
                    {item.body && <p>{item.body}</p>}
                    <span className="inbox-meta">
                      {item.actor && (
                        <span className="inbox-actor">
                          <Avatar name={item.actor.name} color={item.actor.avatar_color} size="xs" /> {item.actor.name}
                        </span>
                      )}
                      {item.workspace && (
                        <span className="inbox-workspace">
                          <span className="color-dot" style={{ background: item.workspace.color }} /> {item.workspace.name}
                        </span>
                      )}
                      <time dateTime={item.created_at}>{formatTime(item.created_at)}</time>
                      <span className={`badge tone-${KIND_META[item.kind]?.tone ?? 'muted'}`}>{KIND_META[item.kind]?.label ?? item.kind}</span>
                    </span>
                  </div>
                  <div className="inbox-actions">
                    <button type="button" className="icon-only" onClick={() => void toggleRead(item)} aria-label={item.read ? `Mark “${item.title}” as unread` : `Mark “${item.title}” as read`} title={item.read ? 'Mark as unread' : 'Mark as read'}>
                      {item.read ? <Mail /> : <MailOpen />}
                    </button>
                    <button type="button" className="icon-only danger-icon" onClick={() => void remove(item)} aria-label={`Delete “${item.title}”`} title="Delete">
                      <Trash2 />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {cursor !== null && (
        <div className="feed-footer">
          <button type="button" className="secondary" onClick={loadMore} disabled={busy !== null}>
            {busy === 'more' && <Loader2 className="spin" />}
            {busy === 'more' ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Clear read notifications?"
          message={`This permanently deletes ${plural(readCount, 'read notification')} shown here and any older read ones. Unread notifications stay.`}
          confirmLabel="Clear read"
          busy={busy === 'clear'}
          onConfirm={clearRead}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  );
}

function InboxSkeleton() {
  return (
    <ul className="inbox-list panel" role="status" aria-label="Loading notifications">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index} className="inbox-item">
          <div className="skeleton notification-icon" />
          <div className="inbox-text">
            <div className="skeleton" style={{ width: `${45 + index * 9}%` }} />
            <div className="skeleton" style={{ width: '30%' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
