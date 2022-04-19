import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../lib/cx';
import { pageWindow } from '../lib/table';

type PaginationProps = { page: number; pageCount: number; onChange: (page: number) => void; summary?: string };

export function Pagination({ page, pageCount, onChange, summary }: PaginationProps) {
  return (
    <nav className="pagination" aria-label="Pagination">
      {summary && <span className="muted">{summary}</span>}
      <div className="pager">
        <button type="button" className="icon-only" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft />
        </button>
        {pageWindow(page, pageCount).map((p, index) =>
          p === null ? (
            <span key={`gap-${index}`} className="gap">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={cx('page', p === page && 'active')}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className="icon-only" aria-label="Next page" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          <ChevronRight />
        </button>
      </div>
    </nav>
  );
}
