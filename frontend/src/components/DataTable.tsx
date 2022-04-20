import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cx } from '../lib/cx';
import { paginate, sortBy, toggleSort, type SortState } from '../lib/table';
import { Pagination } from './Pagination';

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number | boolean | null | undefined | Date;
  align?: 'left' | 'right' | 'center';
  width?: string;
  className?: string;
};

type DataTableProps<T> = {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  initialSort?: SortState;
  pageSize?: number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
};

/** Sortable, paginated table. Sorting and paging happen client-side over `rows`. */
export function DataTable<T>({ rows, columns, rowKey, initialSort, pageSize = 10, empty, onRowClick, caption, rowClassName }: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort) return [...rows];
    const column = columns.find((c) => c.key === sort.key);
    return column?.sortValue ? sortBy(rows, column.sortValue, sort.direction) : [...rows];
  }, [rows, columns, sort]);
  const slice = paginate(sorted, page, pageSize);

  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const Icon = !active ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={column.key}
                  style={{ width: column.width, textAlign: column.align }}
                  aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortValue ? (
                    <button type="button" className={cx('sort-button', active && 'active')} onClick={() => setSort(toggleSort(sort, column.key))}>
                      {column.header}
                      <Icon />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {slice.rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cx(onRowClick && 'clickable', rowClassName?.(row))}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className} style={{ textAlign: column.align }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {!slice.rows.length && (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {slice.pageCount > 1 && (
        <Pagination page={slice.page} pageCount={slice.pageCount} onChange={setPage} summary={`${slice.from}–${slice.to} of ${slice.total}`} />
      )}
    </div>
  );
}
