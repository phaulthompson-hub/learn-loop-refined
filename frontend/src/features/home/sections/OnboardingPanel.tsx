import { Link } from 'react-router-dom';
import { ArrowRight, Check, Rocket } from 'lucide-react';
import { cx } from '../../../lib/cx';
import { onboardingSteps } from '../homeLogic';
import type { Onboarding } from '../types';

/** First-run checklist for a new workspace: course, deck, study session. */
export function OnboardingPanel({ onboarding }: { onboarding: Onboarding }) {
  const steps = onboardingSteps(onboarding);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="onboarding" aria-labelledby="onboarding-title">
      <header>
        <span className="onboarding-icon" aria-hidden="true">
          <Rocket />
        </span>
        <div>
          <h2 id="onboarding-title">Set up your learning loop</h2>
          <p>
            Three small steps turn this workspace into a study plan that adapts to you. {done} of {steps.length} done.
          </p>
        </div>
        <div className="onboarding-meter" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          <i style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </header>
      <ol className="onboarding-steps">
        {steps.map((step, index) => (
          <li key={step.key} className={cx(step.done && 'done')}>
            <span className="step-number" aria-hidden="true">
              {step.done ? <Check /> : index + 1}
            </span>
            <div>
              <b>{step.title}</b>
              <p>{step.description}</p>
            </div>
            {step.done ? (
              <span className="badge ok">Done</span>
            ) : (
              <Link className="secondary small" to={step.to}>
                {step.cta} <ArrowRight />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
