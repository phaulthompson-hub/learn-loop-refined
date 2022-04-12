/** Join class names, skipping falsy values: cx('card', active && 'active'). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
