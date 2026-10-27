/**
 * Shared building blocks. Ports of lib/widgets/common.dart, sized for a phone
 * in a windscreen cradle glanced at for under a second.
 */
import { ArrowLeft, CloudOff, RefreshCw, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

import { failureMessage } from '../api/failures';
import { useGoBack } from './navigation';

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(' ');

/** A labelled block of information, sized to be read at a glance. */
export function InfoCard(props: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={cx('card', props.className)} aria-label={props.label}>
      {props.children}
    </section>
  );
}

/**
 * A requirement the driver must have understood before setting off. Icon
 * **and** word, never colour alone (WCAG 1.4.1).
 */
export function RequirementChip(props: { icon: LucideIcon; label: string }) {
  const Icon = props.icon;
  return (
    <span className="chip">
      <Icon size={20} aria-hidden />
      {props.label}
    </span>
  );
}

/** Nothing to do, said in words. */
export function EmptyState(props: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="empty">
      <Icon className="empty-icon" size={56} aria-hidden />
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      {props.action && <div className="empty-action">{props.action}</div>}
    </div>
  );
}

/** A failure, with a way out. Never a stack trace and never a URL. */
export function FailureBlock(props: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={CloudOff}
      title="Something went wrong"
      message={failureMessage(props.error)}
      action={
        props.onRetry && (
          <Button variant="outlined" icon={RefreshCw} onClick={props.onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

export function Spinner({
  label = 'Loading',
  small,
}: {
  label?: string;
  small?: boolean;
}) {
  return (
    <div
      className={cx('spinner', small && 'small')}
      role="progressbar"
      aria-label={label}
    />
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <div className="centered">{children}</div>;
}

type Variant = 'primary' | 'outlined' | 'text' | 'danger' | 'danger-outlined' | 'quiet';

/**
 * `primary` is the one enormous action a screen is arranged around — 64px
 * tall, full width.
 */
export function Button({
  variant = 'primary',
  icon: Icon,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  icon?: LucideIcon;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx('btn', `btn-${variant}`, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <Spinner small label="Working" />
      ) : (
        Icon && <Icon size={22} aria-hidden />
      )}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={24} aria-hidden />
    </button>
  );
}

export function TextField({
  label,
  helper,
  error,
  ...input
}: {
  label: string;
  helper?: string;
  error?: string | null;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={cx('field', error && 'invalid')}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={`${id}-desc`}
        {...input}
      />
      <div id={`${id}-desc`}>
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : (
          helper && <div className="helper">{helper}</div>
        )}
      </div>
    </div>
  );
}

/** A screen: a top bar and a readable-width body, with an optional pinned footer. */
export function Page(props: {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const goBack = useGoBack(props.back);

  useEffect(() => {
    document.title = props.title
      ? `${props.title} · CareBridge driver`
      : 'CareBridge driver';
  }, [props.title]);

  return (
    <div className="page">
      <header className="top-bar">
        {props.back !== undefined && (
          <IconButton icon={ArrowLeft} label="Back" onClick={goBack} />
        )}
        <h1>{props.title}</h1>
        <div className="top-actions">{props.actions}</div>
      </header>
      <main className="screen-body">{props.children}</main>
      {props.footer && <footer className="action-bar">{props.footer}</footer>}
    </div>
  );
}
