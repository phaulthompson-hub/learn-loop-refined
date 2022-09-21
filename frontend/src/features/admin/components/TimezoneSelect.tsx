import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronsUpDown, Globe } from 'lucide-react';
import { useNow } from '../../../app/clock';
import { cx } from '../../../lib/cx';
import { filterTimezones } from '../validation';
import { timezoneLabel, utcOffset } from '../timezones';

type Props = {
  value: string;
  zones: readonly string[];
  onChange: (zone: string) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * Searchable time zone picker following the ARIA combobox pattern: type to filter,
 * arrows to move, Enter to pick, Escape to close and restore the current value.
 */
export function TimezoneSelect({ value, zones, onChange, id, ...aria }: Props) {
  const now = useNow();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // With no search text the current zone leads the list, so opening the picker shows the selection.
  const options = useMemo(
    () => (search.trim() ? filterTimezones(zones, search) : [value, ...filterTimezones(zones.filter((z) => z !== value), '', 59)]),
    [zones, search, value],
  );

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  const choose = (zone: string) => {
    onChange(zone);
    close();
  };

  const move = (next: number) => {
    const index = (next + options.length) % Math.max(options.length, 1);
    setActive(index);
    list.current?.children[index]?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (!open) setOpen(true);
      else move(active + 1);
    } else if (event.key === 'ArrowUp') move(active - 1);
    else if (event.key === 'Enter' && open) {
      if (options[active]) choose(options[active]);
    } else if (event.key === 'Escape' && open) close();
    else return;
    event.preventDefault();
  };

  return (
    <div className="tz-select">
      <div className="tz-input">
        <Globe aria-hidden="true" />
        <input
          id={id}
          {...aria}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={open ? search : value}
          placeholder={open ? `Search, e.g. ${timezoneLabel(value).split(' (')[0]}` : undefined}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={close}
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="tz-offset">{utcOffset(value, now)}</span>
        <ChevronsUpDown aria-hidden="true" />
      </div>
      {open && (
        <ul className="tz-list" role="listbox" id={listId} ref={list}>
          {options.map((zone, index) => (
            <li
              key={zone}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={zone === value}
              className={cx(index === active && 'active', zone === value && 'selected')}
              // mousedown (not click) so the choice lands before the input's blur closes the list
              onMouseDown={(event) => {
                event.preventDefault();
                choose(zone);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <span>{timezoneLabel(zone)}</span>
              <small>{utcOffset(zone, now)}</small>
            </li>
          ))}
          {!options.length && <li className="tz-empty">No time zone matches “{search}”.</li>}
        </ul>
      )}
    </div>
  );
}
