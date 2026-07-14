import { useState } from 'react';
import { db } from '../lib/instant';
import { LogoMark } from './Logo';

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'body' in error) {
    const body = (error as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function SyncLogin({ initialError = '' }: { initialError?: string }) {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const sendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail) return;
    setBusy(true);
    setError('');
    try {
      await db.auth.sendMagicCode({ email: nextEmail });
      setSentEmail(nextEmail);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code: code.trim() });
    } catch (nextError) {
      setCode('');
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sync-auth-page">
      <section className="sync-auth-panel" aria-labelledby="sync-auth-title">
        <div className="sync-auth-brand">
          <LogoMark size={38} />
          <span>
            <strong>ADHD</strong> Calendar
          </span>
        </div>
        <div className="sync-auth-copy">
          <h1 id="sync-auth-title">{sentEmail ? 'Enter your code' : 'Sync your calendar'}</h1>
          <p>
            {sentEmail
              ? `We sent a sign-in code to ${sentEmail}.`
              : 'Sign in on web and iPhone with the same email address.'}
          </p>
        </div>

        {sentEmail ? (
          <form className="sync-auth-form" onSubmit={verifyCode}>
            <label htmlFor="sync-code">Verification code</label>
            <input
              id="sync-code"
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            {error && <p className="error-text">{error}</p>}
            <button className="btn sync-auth-primary" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              className="btn btn-ghost sync-auth-secondary"
              onClick={() => {
                setSentEmail('');
                setCode('');
                setError('');
              }}
            >
              Use another email
            </button>
          </form>
        ) : (
          <form className="sync-auth-form" onSubmit={sendCode}>
            <label htmlFor="sync-email">Email address</label>
            <input
              id="sync-email"
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoFocus
              required
            />
            {error && <p className="error-text">{error}</p>}
            <button className="btn sync-auth-primary" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send sign-in code'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export function SyncLoading({
  label = 'Loading your calendar…',
  error = '',
}: {
  label?: string;
  error?: string;
}) {
  return (
    <main className="sync-auth-page">
      <section className="sync-auth-panel sync-loading-panel" aria-live="polite">
        <div className="sync-auth-brand">
          <LogoMark size={38} />
          <span>
            <strong>ADHD</strong> Calendar
          </span>
        </div>
        {error ? (
          <>
            <h1>Sync unavailable</h1>
            <p className="error-text">{error}</p>
            <button className="btn btn-ghost" onClick={() => db.auth.signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <span className="sync-spinner" aria-hidden="true" />
            <p>{label}</p>
          </>
        )}
      </section>
    </main>
  );
}
