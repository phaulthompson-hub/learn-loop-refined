import type { ReactNode } from 'react';
import { Cpu, CalendarCheck2, Layers, Spline } from 'lucide-react';

const POINTS = [
  { icon: Spline, title: 'Adaptive paths', text: 'Concepts unlock as your mastery grows, so you always know what to study next.' },
  { icon: Layers, title: 'Spaced repetition', text: 'Flashcards come back right before you would forget them.' },
  { icon: CalendarCheck2, title: 'Plan together', text: 'Shared calendars, boards and notes for your whole study group.' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-story">
        <div className="brand">
          <Cpu />
          <span>
            Learn<b>Loop</b>
          </span>
        </div>
        <h1>
          Study smarter,
          <br />
          <em>as a team.</em>
        </h1>
        <ul>
          {POINTS.map(({ icon: Icon, title: pointTitle, text }) => (
            <li key={pointTitle}>
              <Icon />
              <div>
                <b>{pointTitle}</b>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="auth-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-card">
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  );
}
