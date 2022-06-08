import { useDeferredValue, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '../../../app/toast';
import { Field } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { plural, truncate } from '../../../lib/format';
import { flashcardsApi } from '../api';
import { IMPORT_MAX_LINES, countImportLines, parseImport } from '../importParser';
import type { ImportResult } from '../types';

type ImportModalProps = {
  deckId: number;
  deckName: string;
  existingFronts: string[];
  onImported: (result: ImportResult) => void;
  onClose: () => void;
};

const PREVIEW_ROWS = 60;
const PLACEHOLDER = `# One card per line: front :: back :: optional hint
What is a primary key? :: A column whose value uniquely identifies each row
What does ACID stand for? :: Atomicity, consistency, isolation, durability :: Four words`;

/** Paste `front :: back` lines, see which ones will be accepted (and why others will not), then import. */
export function ImportModal({ deckId, deckName, existingFronts, onImported, onClose }: ImportModalProps) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Parsing a long paste on every keystroke is cheap, but deferring keeps typing smooth for 500 lines.
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => parseImport(deferred, existingFronts), [deferred, existingFronts]);
  const lineCount = countImportLines(deferred);
  const tooMany = lineCount > IMPORT_MAX_LINES;
  const rows = [
    ...parsed.accepted.map((line) => ({ line: line.line, ok: true as const, front: line.front, back: line.back })),
    ...parsed.rejected.map((line) => ({ line: line.line, ok: false as const, text: line.text, reason: line.reason })),
  ].sort((a, b) => a.line - b.line);

  const submit = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const result = await flashcardsApi.importCards(deckId, text);
      toast.success(`Imported ${plural(result.created, 'card')}${result.rejected.length ? `, skipped ${result.rejected.length}` : ''}`);
      onImported(result);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Import cards"
      description={`Add many cards to ${deckName} at once.`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving || tooMany || !parsed.accepted.length || text !== deferred} onClick={() => void submit()}>
            {saving ? 'Importing…' : `Import ${plural(parsed.accepted.length, 'card')}`}
          </button>
        </>
      }
    >
      <div className="fc-import">
        <Field
          label="Cards"
          hint="One card per line as front :: back, optionally :: hint. Lines starting with # are ignored."
          error={tooMany ? `Import at most ${IMPORT_MAX_LINES} cards at a time (${lineCount} lines).` : serverError ?? undefined}
          aside={plural(lineCount, 'line')}
        >
          <textarea className="fc-import-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={PLACEHOLDER} spellCheck={false} data-autofocus />
        </Field>
        <section className="fc-import-preview" aria-live="polite" aria-label="Import preview">
          <div className="row">
            <span className="badge ok">
              <CheckCircle2 /> {parsed.accepted.length} ready
            </span>
            <span className={parsed.rejected.length ? 'badge bad' : 'badge'}>
              <XCircle /> {parsed.rejected.length} skipped
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="muted">Paste or type lines to see a preview.</p>
          ) : (
            <ol className="fc-import-rows">
              {rows.slice(0, PREVIEW_ROWS).map((row) =>
                row.ok ? (
                  <li key={row.line} className="is-ok">
                    <span className="fc-import-line">{row.line}</span>
                    <CheckCircle2 aria-label="Ready" />
                    <span>
                      <b>{truncate(row.front, 80)}</b> <span className="muted">→ {truncate(row.back, 80)}</span>
                    </span>
                  </li>
                ) : (
                  <li key={row.line} className="is-bad">
                    <span className="fc-import-line">{row.line}</span>
                    <XCircle aria-label="Skipped" />
                    <span>
                      <b>{row.reason}</b> <span className="muted">{truncate(row.text, 80)}</span>
                    </span>
                  </li>
                ),
              )}
              {rows.length > PREVIEW_ROWS && <li className="muted">…and {rows.length - PREVIEW_ROWS} more lines</li>}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
