import { MailCheck, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Failure, failureMessage } from '../api/failures';
import type { components } from '../api/schema';
import { useRun } from '../components/useRun';
import {
  Button,
  Centered,
  EmptyState,
  FailureBlock,
  InfoCard,
  Page,
  Spinner,
  TextField,
} from '../components/ui';
import { useStore } from '../state/context';

type Onboarding = components['schemas']['DriverOnboardingDto'];

type Field =
  | 'joinCode'
  | 'phone'
  | 'yearsDriving'
  | 'make'
  | 'model'
  | 'color'
  | 'licensePlate';

/**
 * Applying to a transport company: the code they handed out, a number dispatch
 * can ring, and the vehicle. The application then waits for the company to
 * approve it, and the paperwork upload is the next screen.
 */
export function ApplyScreen() {
  const store = useStore();
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOnboarding(await store.api.onboarding());
    } catch (failure) {
      setError(failure);
    }
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  // Already somebody's driver — including a place the company made for this
  // address, which reading onboarding has just claimed.
  const hasProfile = onboarding?.hasDriverProfile ?? false;
  useEffect(() => {
    if (hasProfile) void store.refreshProfile();
  }, [hasProfile, store]);

  let body;
  if (hasProfile) {
    return <Navigate to="/today" replace />;
  } else if (onboarding && !onboarding.emailVerified) {
    body = <VerifyFirst email={onboarding.email} onChecked={load} />;
  } else if (onboarding) {
    body = <ApplicationForm fullName={onboarding.fullName} />;
  } else if (error) {
    body = <FailureBlock error={error} onRetry={() => void load()} />;
  } else {
    body = (
      <Centered>
        <Spinner />
      </Centered>
    );
  }

  return (
    <Page title="Apply to drive" back="/today">
      {body}
    </Page>
  );
}

function VerifyFirst(props: { email: string; onChecked: () => Promise<void> }) {
  const store = useStore();
  const { run, busy } = useRun();
  const [sent, setSent] = useState(false);

  return (
    <EmptyState
      icon={MailCheck}
      title="Verify your email first"
      message={`We sent a link to ${props.email}. Open it on this phone or any other device, then come back and tap “I’ve verified”.`}
      action={
        <div className="stack gap-sm">
          <Button
            icon={RefreshCw}
            busy={busy}
            onClick={() => void run(props.onChecked)}
          >
            I’ve verified
          </Button>
          <Button
            variant="outlined"
            icon={Send}
            disabled={busy || sent}
            onClick={() =>
              void run(async () => {
                await store.api.resendVerification(props.email);
                setSent(true);
              })
            }
          >
            {sent ? 'Email sent again' : 'Send the email again'}
          </Button>
        </div>
      }
    />
  );
}

function ApplicationForm({ fullName }: { fullName: string }) {
  const store = useStore();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState('');
  const [phone, setPhone] = useState('');
  const [yearsDriving, setYearsDriving] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [accessible, setAccessible] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const years = Number(yearsDriving);
    const next: typeof errors = {};
    if (joinCode.trim() === '')
      next.joinCode = 'Enter the code from your transport company';
    if (phone.trim() === '') next.phone = 'Enter a phone number';
    if (
      yearsDriving.trim() === '' ||
      !(Number.isInteger(years) && years >= 0 && years <= 60)
    )
      next.yearsDriving = 'A whole number from 0 to 60';
    if (make.trim() === '') next.make = 'Required';
    if (model.trim() === '') next.model = 'Required';
    if (color.trim() === '') next.color = 'Required';
    if (licensePlate.trim() === '') next.licensePlate = 'Required';
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await store.apply({
        joinCode,
        phone,
        yearsDriving: years,
        vehicle: {
          make,
          model,
          color,
          licensePlate,
          isWheelchairAccessible: accessible,
        },
      });
      // Approval waits on the paperwork, so that is the next thing to do.
      navigate('/documents', { replace: true });
    } catch (failure) {
      if (failure instanceof Failure && failure.field)
        setErrors({ [failure.field]: failure.message });
      else setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack gap-md" onSubmit={submit} noValidate>
      <InfoCard label="Applying as">
        <p className="t-title-lg">{fullName}</p>
        <p className="t-small muted">
          Your transport company checks this against the licence you upload next.
        </p>
      </InfoCard>
      <TextField
        label="Company code"
        helper="Eight letters and numbers, like K7QM-2RXD. Ask your transport company for it."
        autoCapitalize="characters"
        autoComplete="off"
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value)}
        error={errors.joinCode}
      />
      <TextField
        label="Phone number"
        type="tel"
        autoComplete="tel"
        helper="So dispatch can reach you during a trip."
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errors.phone}
      />
      <TextField
        label="Years driving"
        type="number"
        inputMode="numeric"
        min={0}
        max={60}
        value={yearsDriving}
        onChange={(e) => setYearsDriving(e.target.value)}
        error={errors.yearsDriving}
      />
      <h2 className="t-title mt-sm">Your vehicle</h2>
      <TextField
        label="Make"
        placeholder="Toyota"
        value={make}
        onChange={(e) => setMake(e.target.value)}
        error={errors.make}
      />
      <TextField
        label="Model"
        placeholder="Sienna"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        error={errors.model}
      />
      <TextField
        label="Colour"
        placeholder="Silver"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        error={errors.color}
      />
      <TextField
        label="Licence plate"
        autoCapitalize="characters"
        value={licensePlate}
        onChange={(e) => setLicensePlate(e.target.value)}
        error={errors.licensePlate}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={accessible}
          onChange={(e) => setAccessible(e.target.checked)}
        />
        <span>Wheelchair accessible</span>
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" busy={busy}>
        {busy ? 'Sending your application…' : 'Send application'}
      </Button>
      <p className="t-small muted center">
        Next you upload your licence, insurance and registration. Your company approves
        you once it has checked them.
      </p>
    </form>
  );
}
