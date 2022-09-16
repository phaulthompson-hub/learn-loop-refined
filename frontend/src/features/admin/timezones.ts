// IANA time zone names for the profile picker. The API validates against Python's zoneinfo database,
// which contains every canonical zone the browser reports.
const FALLBACK = ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];

function supportedZones(): string[] {
  try {
    // `Intl.supportedValuesOf` is missing from the TypeScript 4.9 lib typings, so reach it through a narrow cast.
    return (Intl as unknown as { supportedValuesOf(key: 'timeZone'): string[] }).supportedValuesOf('timeZone');
  } catch {
    return FALLBACK;
  }
}

/** Sorted zones with UTC first. `current` is kept even if the browser does not list it (e.g. a legacy alias). */
export function timezoneList(current?: string): string[] {
  const zones = new Set(['UTC', ...supportedZones().filter((zone) => zone !== 'UTC').sort()]);
  if (current) zones.add(current);
  return [...zones];
}

/** "America/New_York" -> "New York (America)" */
export function timezoneLabel(zone: string): string {
  const parts = zone.split('/');
  if (parts.length === 1) return zone;
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  return `${city} (${parts.slice(0, -1).join(' / ').replace(/_/g, ' ')})`;
}

/** Current UTC offset of a zone at `now`, e.g. "UTC+01:00"; empty when the runtime does not know the zone. */
export function utcOffset(zone: string, now: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName');
    const value = part?.value.replace('GMT', 'UTC') ?? '';
    return value === 'UTC' ? 'UTC+00:00' : value;
  } catch {
    return '';
  }
}
