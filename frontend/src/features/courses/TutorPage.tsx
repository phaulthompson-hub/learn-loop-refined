import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bookmark, Bot, Eraser, Lightbulb, Send, User } from 'lucide-react';
import { useClock } from '../../app/clock';
import { ErrorBanner } from '../../components/ui';
import { courseApi } from './api';
import { useCourse } from './courseContext';
import { tutorSuggestions } from './text';
import type { TutorMode } from './types';

type Message = { id: number; role: 'me' | 'tutor'; text: string; followUp?: string; citations?: string[]; mode?: TutorMode };

const MODE_LABEL: Record<TutorMode, string> = {
  demo: 'Offline tutor',
  openai: 'LLM tutor',
  fallback: 'Offline fallback',
};

const MESSAGE_MAX = 2000;

export function TutorPage() {
  const { course } = useCourse();
  const { aiMode } = useClock();
  const [params, setParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const log = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);

  const sourceIds = new Map(course.sources.map((s) => [s.name, s.id]));
  const suggestions = tutorSuggestions(course.concepts);

  const ask = async (text: string) => {
    const message = text.trim();
    if (message.length < 2) {
      setError('Type a question of at least 2 characters.');
      return;
    }
    if (sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    setMessages((list) => [...list, { id: nextId.current++, role: 'me', text: message }]);
    try {
      const reply = await courseApi.tutor(course.id, message);
      setMessages((list) => [
        ...list,
        { id: nextId.current++, role: 'tutor', text: reply.answer, followUp: reply.follow_up, citations: reply.citations, mode: reply.mode },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The tutor could not answer');
      setDraft(message);
    } finally {
      setSending(false);
    }
  };

  // A question handed over from another page (?ask=...) is sent once, then removed from the URL.
  useEffect(() => {
    const preset = params.get('ask');
    if (!preset || asked.current === preset) return;
    asked.current = preset;
    setParams({}, { replace: true });
    void ask(preset);
  });

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  };

  return (
    <section className="panel tutor" aria-labelledby="tutor-title">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Grounded tutor</p>
          <h2 id="tutor-title">Ask about {course.title}</h2>
        </div>
        <div className="actions">
          <span className="badge info" title="Answers come only from this course's sources">
            {aiMode === 'openai' ? 'LLM with source grounding' : 'Offline, answers from your sources'}
          </span>
          {messages.length > 0 && (
            <button type="button" className="ghost small" onClick={() => setMessages([])} disabled={sending}>
              <Eraser /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="messages" ref={log} aria-live="polite" aria-busy={sending}>
        {messages.length === 0 && (
          <div className="tutor-welcome">
            <Bot aria-hidden="true" />
            <p>
              I answer from the {course.source_count === 1 ? 'source' : `${course.source_count} sources`} in this course and tell you which
              one I used. Try one of these:
            </p>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`msg ${m.role}`}>
            <span className="msg-avatar" aria-hidden="true">
              {m.role === 'me' ? <User /> : <Bot />}
            </span>
            <div className="msg-bubble">
              <p className="sr-only">{m.role === 'me' ? 'You asked:' : 'Tutor answered:'}</p>
              <p>{m.text}</p>
              {m.followUp && (
                <p className="msg-follow-up">
                  <Lightbulb /> {m.followUp}
                </p>
              )}
              {m.citations && m.citations.length > 0 && (
                <div className="citations">
                  <Bookmark aria-hidden="true" />
                  <span>Sources:</span>
                  {m.citations.map((name) =>
                    sourceIds.has(name) ? (
                      <Link key={name} to={`/courses/${course.id}/sources/${sourceIds.get(name)}`}>
                        {name}
                      </Link>
                    ) : (
                      <span key={name}>{name}</span>
                    ),
                  )}
                  {m.mode && <span className={`badge ${m.mode === 'fallback' ? 'warn' : ''}`}>{MODE_LABEL[m.mode]}</span>}
                </div>
              )}
            </div>
          </article>
        ))}
        {sending && (
          <div className="msg tutor">
            <span className="msg-avatar" aria-hidden="true">
              <Bot />
            </span>
            <div className="msg-bubble typing" aria-label="The tutor is thinking">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <button type="button" key={s} onClick={() => void ask(s)} disabled={sending}>
              {s}
            </button>
          ))}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      <form className="tutor-form" onSubmit={onSubmit}>
        <label htmlFor="tutor-message" className="sr-only">
          Your question
        </label>
        <textarea
          id="tutor-message"
          rows={2}
          value={draft}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your material… (Enter to send, Shift+Enter for a new line)"
        />
        <div className="tutor-form-side">
          <small className="muted">
            {draft.length}/{MESSAGE_MAX}
          </small>
          <button type="submit" className="primary" disabled={sending || draft.trim().length < 2}>
            <Send /> Ask
          </button>
        </div>
      </form>
    </section>
  );
}
