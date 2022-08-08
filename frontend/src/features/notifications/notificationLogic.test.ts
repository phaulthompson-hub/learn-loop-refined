import { describe, expect, it } from 'vitest';
import { badgeText, bellLabel, isInternalLink, isKind, KINDS, withAllRead, withoutIds, withRead } from './notificationLogic';
import type { AppNotification } from './types';

const note = (id: number, read: boolean): AppNotification => ({
  id,
  kind: 'comment',
  title: `Note ${id}`,
  body: '',
  link: '/board',
  created_at: '2022-03-14T08:00:00',
  read_at: read ? '2022-03-14T08:30:00' : null,
  read,
  actor: null,
  workspace: null,
});

describe('bell badge', () => {
  it('hides zero and caps at 9+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(-1)).toBe('');
    expect(badgeText(4)).toBe('4');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(12)).toBe('9+');
  });

  it('announces the unread count', () => {
    expect(bellLabel(0)).toBe('Notifications, all caught up');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
  });
});

describe('list updates', () => {
  const items = [note(1, false), note(2, true), note(3, false)];
  const now = '2022-03-14T09:00:00';

  it('marks one item read or unread without touching the others', () => {
    const read = withRead(items, 1, true, now);
    expect(read[0]).toMatchObject({ read: true, read_at: now });
    expect(read[1]).toBe(items[1]);
    const unread = withRead(items, 2, false, now);
    expect(unread[1]).toMatchObject({ read: false, read_at: null });
  });

  it('keeps the original read time when marking read again', () => {
    expect(withRead(items, 2, true, now)[1].read_at).toBe('2022-03-14T08:30:00');
  });

  it('marks everything read', () => {
    const all = withAllRead(items, now);
    expect(all.every((i) => i.read)).toBe(true);
    expect(all[1].read_at).toBe('2022-03-14T08:30:00');
    expect(all[2].read_at).toBe(now);
  });

  it('removes items by id', () => {
    expect(withoutIds(items, new Set([1, 3])).map((i) => i.id)).toEqual([2]);
  });
});

describe('guards', () => {
  it('recognises notification kinds', () => {
    expect(KINDS).toContain('review_due');
    expect(isKind('mastery')).toBe(true);
    expect(isKind('spam')).toBe(false);
    expect(isKind(null)).toBe(false);
  });

  it('only follows in-app links', () => {
    expect(isInternalLink('/board?task=5')).toBe(true);
    expect(isInternalLink('')).toBe(false);
    expect(isInternalLink('https://example.com')).toBe(false);
    expect(isInternalLink('//evil.example')).toBe(false);
  });
});
