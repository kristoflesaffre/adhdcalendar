import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The one-time Google setup, decomposed into five checkable steps that each
 * deep-link to the exact Google page. Google makes this fiddly for every
 * app that writes to a calendar — the wizard's job is to remove every
 * decision except "click the button and copy what we tell you".
 */

const DONE_KEY = 'carillon.gsetup.v1';

function loadDone(): number[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-chip"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      title="Copy to clipboard"
    >
      <code>{value}</code>
      <span className="copy-chip-label">{copied ? 'Copied ✓' : 'Copy'}</span>
    </button>
  );
}

interface StepDef {
  title: string;
  body: ReactNode;
  href: string;
  linkLabel: string;
}

const STEPS: StepDef[] = [
  {
    title: 'Create a (free) Google Cloud project',
    href: 'https://console.cloud.google.com/projectcreate',
    linkLabel: 'Open “New project”',
    body: (
      <>
        Name it anything — <strong>ADHD Calendar</strong> works. Click <strong>Create</strong> and wait a
        few seconds. Free, no credit card.
      </>
    ),
  },
  {
    title: 'Turn on the Calendar API',
    href: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
    linkLabel: 'Open the Calendar API page',
    body: (
      <>
        Click the blue <strong>Enable</strong> button. If the page asks for a project first, pick the one
        from step 1 in the dropdown at the top of the page.
      </>
    ),
  },
  {
    title: 'Fill in the consent screen',
    href: 'https://console.cloud.google.com/auth/overview',
    linkLabel: 'Open “Google Auth Platform”',
    body: (
      <>
        Click <strong>Get started</strong>. App name: <strong>ADHD Calendar</strong>, support email: your
        own. Audience: <strong>External</strong>. Contact: your email again. Agree and{' '}
        <strong>Create</strong>. (Ignore anything about verification — you won’t need it.)
      </>
    ),
  },
  {
    title: 'Add yourself as a test user  ← the step everyone misses',
    href: 'https://console.cloud.google.com/auth/audience',
    linkLabel: 'Open “Audience”',
    body: (
      <>
        Under <strong>Test users</strong>, click <strong>+ Add users</strong> and enter your own Gmail
        address (and your girlfriend’s, if you’ll share). <strong>Only these accounts can sign in.</strong>{' '}
        Skipping this is the #1 cause of the “Access blocked” error.
      </>
    ),
  },
  {
    title: 'Create the Client ID',
    href: 'https://console.cloud.google.com/auth/clients/create',
    linkLabel: 'Open “Create client”',
    body: (
      <>
        Application type: <strong>Web application</strong>. Under{' '}
        <strong>Authorized JavaScript origins</strong>, click <strong>+ Add URI</strong> and paste exactly
        this (no slash at the end): <CopyChip value={location.origin} />
        <br />
        Click <strong>Create</strong>, then copy the Client ID (it ends in{' '}
        <code>.apps.googleusercontent.com</code>) and paste it below.
      </>
    ),
  },
];

export function GoogleSetupWizard() {
  const [done, setDone] = useState<number[]>(loadDone);

  const toggle = (i: number) => {
    setDone((prev) => {
      const next = prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i];
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="wizard">
      <p className="settings-hint">
        Google requires this once for any app that can write to your calendar — it’s fiddly for everyone,
        not just you. Five steps, ±5 minutes, never again. Tick each one off as you go.
        {done.length > 0 && done.length < STEPS.length && (
          <strong> ({done.length} of {STEPS.length} done)</strong>
        )}
      </p>
      <ol className="wizard-steps">
        {STEPS.map((step, i) => {
          const isDone = done.includes(i);
          return (
            <li key={i} className={`wizard-step${isDone ? ' is-done' : ''}`}>
              <button
                type="button"
                className="wizard-check"
                aria-pressed={isDone}
                aria-label={isDone ? `Step ${i + 1} done` : `Mark step ${i + 1} as done`}
                onClick={() => toggle(i)}
              >
                {isDone ? '✓' : i + 1}
              </button>
              <div className="wizard-step-body">
                <div className="wizard-step-title">{step.title}</div>
                {!isDone && (
                  <>
                    <p>{step.body}</p>
                    <a className="btn btn-ghost connect-open" href={step.href} target="_blank" rel="noreferrer">
                      {step.linkLabel} ↗
                    </a>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Google's cryptic sign-in errors, translated to the exact fix */
export function SignInTroubleshooting() {
  return (
    <details className="advanced-details">
      <summary>Sign-in fails? Google’s errors, decoded</summary>
      <ul className="troubleshoot-list">
        <li>
          <strong>“Access blocked” / “Error 403: access_denied”</strong> — your Google account isn’t on
          the Test users list. Fix: step 4 above, add your Gmail, wait a minute, try again.
        </li>
        <li>
          <strong>“Google hasn’t verified this app”</strong> — normal for a personal app. Click{' '}
          <strong>Continue</strong> (sometimes hidden under “Advanced”). It’s your own app; there’s nothing
          unsafe about it.
        </li>
        <li>
          <strong>“Error 400: origin_mismatch / redirect_uri_mismatch”</strong> — the address in step 5
          doesn’t match exactly. It must be <code>{location.origin}</code> — no slash at the end, and
          <code> http</code> vs <code>https</code> matters. Changes take a few minutes to kick in.
        </li>
        <li>
          <strong>“Error 401: invalid_client”</strong> — the Client ID was pasted incompletely. Copy it
          again from step 5; it ends in <code>.apps.googleusercontent.com</code>.
        </li>
        <li>
          <strong>Nothing happens at all</strong> — your browser blocked the popup. Allow popups for this
          site and click Sign in again.
        </li>
      </ul>
    </details>
  );
}
