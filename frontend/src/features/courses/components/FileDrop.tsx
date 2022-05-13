import { useId, useRef, useState, type DragEvent } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { ALLOWED_EXTENSIONS, formatBytes } from '../../../lib/validation';

type Props = { file: File | null; onChange: (file: File | null) => void; error?: string };

/** Drag-and-drop zone that also works as a regular (keyboard-accessible) file picker. */
export function FileDrop({ file, onChange, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  };

  if (file) {
    return (
      <div className={cx('file-chosen', error && 'invalid')}>
        <FileText aria-hidden="true" />
        <div>
          <b>{file.name}</b>
          <small className="muted">{formatBytes(file.size)}</small>
        </div>
        <button type="button" className="ghost small" onClick={() => onChange(null)}>
          <X /> Remove
        </button>
      </div>
    );
  }

  return (
    <div
      className={cx('file-drop', over && 'is-over', error && 'invalid')}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <UploadCloud aria-hidden="true" />
      <p>
        <b>Drop a file here</b> or{' '}
        <button type="button" className="link-button" onClick={() => input.current?.click()} aria-describedby={hintId}>
          browse your computer
        </button>
      </p>
      <small id={hintId} className="muted">
        PDF, TXT or Markdown · up to 8 MB
      </small>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={ALLOWED_EXTENSIONS.join(',')}
        aria-label="Choose a file"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}
