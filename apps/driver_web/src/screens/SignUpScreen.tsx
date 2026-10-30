import { CarFront } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Failure, failureMessage } from '../api/failures';
import { Button, TextField } from '../components/ui';
import { useStore } from '../state/context';

type Field = 'fullName' | 'email' | 'password' | 'acceptedTerms';

/**
 * A new driver's first step. The account is an ordinary CareBridge account —
 * the same one the family app signs in with — and becoming a driver is the
 * application that follows, once the address is verified.
 */
export function SignUpScreen() {
  const store = useStore();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (fullName.trim() === '')
      next.fullName = 'Enter your name as it is on your licence';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter your email address';
    if (password.length < 10) next.password = 'Use at least 10 characters';
    if (!acceptedTerms) next.acceptedTerms = 'Agree to the terms to continue';
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await store.signUp({ fullName, email, password, acceptedTerms });
      navigate('/apply', { replace: true });
    } catch (failure) {
      // A field the server names goes under that field; "already registered"
      // and the like have none and read as a sentence.
      if (failure instanceof Failure && failure.field)
        setErrors({ [failure.field]: failure.message });
      else setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="sign-in">
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <CarFront className="brand-icon" size={56} aria-hidden />
        <h1 className="t-headline center">Drive with CareBridge</h1>
        <p className="muted center">
          Create your account, verify your email, then apply to your transport company
          with the code they gave you.
        </p>
        <TextField
          label="Full name"
          helper="As it appears on your driving licence."
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          helper="At least 10 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
          />
          <span>I agree to the terms of service and privacy notice.</span>
        </label>
        {errors.acceptedTerms && (
          <p className="field-error" role="alert">
            {errors.acceptedTerms}
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
        <p className="center">
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
