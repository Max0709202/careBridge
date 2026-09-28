import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { validationFailure } from '../../api/failures';
import { safeNext } from '../../App';
import { useFeedback } from '../../components/feedback';
import { Button, CheckboxRow, Page, TextField } from '../../components/ui';
import { useStore } from '../../state/context';

export function RegisterScreen() {
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { showFailure } = useFeedback();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim() === '') next.name = 'Enter your name.';
    if (email.trim() === '') next.email = 'Enter your email address.';
    else if (!email.includes('@')) next.email = 'That does not look like an email address.';
    if (password === '') next.password = 'Choose a password.';
    else if (password.length < 10) next.password = 'Use at least 10 characters.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!acceptedTerms) {
      showFailure(validationFailure('Please agree to the terms before continuing.'));
      return;
    }

    setBusy(true);
    try {
      await store.register({ fullName: name, email, password, acceptedTerms });
      navigate(safeNext(location.search), { replace: true });
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Create an account" back narrow>
      <form className="stack gap-md" onSubmit={submit} noValidate>
        <p className="t-body-lg muted">
          You will be the organiser for the person you care for. You can invite other relatives
          afterwards.
        </p>
        <TextField
          label="Your name"
          autoComplete="name"
          autoCapitalize="words"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          helper="Used to sign in and to send you updates."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          helper="At least 10 characters. A short phrase you will remember beats a short password full of symbols."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {/* Consent is an explicit, unticked action — never pre-checked, never inferred. */}
        <CheckboxRow
          checked={acceptedTerms}
          onChange={setAcceptedTerms}
          title="I agree to the terms of service and privacy notice."
          subtitle="Placeholder pending legal review."
        />
        <Button type="submit" block disabled={busy} className="mt-sm">
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
        <Button variant="text" block onClick={() => navigate(`/sign-in${location.search}`)}>
          I already have an account
        </Button>
      </form>
    </Page>
  );
}
