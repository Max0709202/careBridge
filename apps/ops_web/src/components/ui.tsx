/**
 * Shared building blocks. Ports of apps/ops_console/lib/widgets/common.dart,
 * sized for a desk tool used all day: denser text than the family app, but
 * 44px hit targets kept anyway — a mis-click here assigns the wrong driver.
 */
import { CloudOff, RefreshCw, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { failureMessage } from '../api/failures';

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/** OpsCard. Clickable when `onClick` is given — then it is a real button for keyboard users. */
export function Card(props: { children: ReactNode; onClick?: () => void; className?: string; label?: string }) {
  if (props.onClick) {
    return (
      <div
        className={cx('card', 'clickable', props.className)}
        role="button"
        tabIndex={0}
        aria-label={props.label}
        onClick={props.onClick}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onClick?.();
          }
        }}
      >
        {props.children}
      </div>
    );
  }
  return (
    <section className={cx('card', props.className)} aria-label={props.label}>
      {props.children}
    </section>
  );
}

export function SectionHeader(props: { title: string; trailing?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>{props.title}</h2>
      {props.trailing}
    </div>
  );
}

export function EmptyState(props: { icon: LucideIcon; title: string; message: string; action?: ReactNode }) {
  const Icon = props.icon;
  return (
    <div className="empty">
      <Icon className="empty-icon" size={40} aria-hidden />
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      {props.action && <div className="empty-action">{props.action}</div>}
    </div>
  );
}

/** "Could not load …", with a retry. Never a stack trace, never a URL. */
export function LoadFailure(props: { title: string; onRetry: () => void; error?: unknown }) {
  return (
    <EmptyState
      icon={CloudOff}
      title={props.title}
      message="Check your connection and try again."
      action={
        <Button variant="outlined" icon={RefreshCw} onClick={props.onRetry}>
          Retry
        </Button>
      }
    />
  );
}

/**
 * Shown above content that is still on screen after a re-read failed. A
 * dispatcher's queue must not vanish because one poll timed out — but it must
 * not pretend to be current either.
 */
export function StaleBanner(props: { error: unknown; onRetry: () => void }) {
  return (
    <div className="stale-banner" role="status">
      <CloudOff size={16} aria-hidden />
      <span className="grow">Could not refresh — showing what was last loaded. {failureMessage(props.error)}</span>
      <Button variant="text" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function Spinner({ label = 'Loading', small }: { label?: string; small?: boolean }) {
  return <div className={cx('spinner', small && 'small')} role="progressbar" aria-label={label} />;
}

/** Occupies the space its content will, so a list does not jump under the pointer. */
export function LoadingBlock() {
  return (
    <div className="loading-block">
      <Spinner />
    </div>
  );
}

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

export function Button({
  variant = 'filled',
  icon: Icon,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; busy?: boolean }) {
  return (
    <button
      type="button"
      className={cx('btn', `btn-${variant}`, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner small label="Working" /> : Icon && <Icon size={18} aria-hidden />}
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
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon size={20} aria-hidden />
    </button>
  );
}

interface FieldProps {
  label: string;
  helper?: string;
  error?: string | null;
  prefix?: string;
  counter?: number;
}

export function TextField({
  label,
  helper,
  error,
  prefix,
  counter,
  className,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const length = typeof input.value === 'string' ? input.value.length : 0;
  return (
    <div className={cx('field', error && 'invalid', className)}>
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        {prefix && <span className="field-prefix">{prefix}</span>}
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={`${id}-desc`}
          maxLength={counter}
          {...input}
        />
      </div>
      <FieldFoot id={`${id}-desc`} helper={helper} error={error} counter={counter} length={length} />
    </div>
  );
}

export function TextArea({
  label,
  helper,
  error,
  counter,
  className,
  ...input
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const length = typeof input.value === 'string' ? input.value.length : 0;
  return (
    <div className={cx('field', error && 'invalid', className)}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        aria-invalid={!!error}
        aria-describedby={`${id}-desc`}
        maxLength={counter}
        rows={2}
        {...input}
      />
      <FieldFoot id={`${id}-desc`} helper={helper} error={error} counter={counter} length={length} />
    </div>
  );
}

function FieldFoot(props: { id: string; helper?: string; error?: string | null; counter?: number; length: number }) {
  return (
    <div id={props.id} className="field-foot">
      {props.error ? (
        <div className="field-error grow" role="alert">
          {props.error}
        </div>
      ) : (
        <div className="helper grow">{props.helper}</div>
      )}
      {props.counter !== undefined && (
        <div className="helper" aria-hidden>
          {props.length}/{props.counter}
        </div>
      )}
    </div>
  );
}

/** A labelled on/off switch — a real checkbox with `role="switch"`. */
export function Switch(props: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  description?: string;
}) {
  const id = useId();
  return (
    <label className={cx('switch', props.disabled && 'disabled')} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden />
      <span className="stack">
        <span>{props.label}</span>
        {props.description && <span className="t-small muted">{props.description}</span>}
      </span>
    </label>
  );
}

/** A label on the left, a figure on the right. */
export function KeyValue(props: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className={cx('kv', props.small && 't-small')}>
      <span className="grow">{props.label}</span>
      <span>{props.value}</span>
    </div>
  );
}

/**
 * A remark under a figure. `emphasis` pairs the colour with a different icon —
 * never colour alone (WCAG 1.4.1).
 */
export function Note(props: { children: ReactNode; emphasis?: boolean; icon?: LucideIcon }) {
  const Icon = props.icon;
  return (
    <p className={cx('note', props.emphasis && 'emphasis')}>
      {Icon && <Icon size={16} aria-hidden />}
      <span>{props.children}</span>
    </p>
  );
}

/**
 * The body of one screen inside a shell: a toolbar with the screen's own
 * actions (Refresh stands in for pull-to-refresh), then the content.
 */
export function Screen(props: { title: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    document.title = `${props.title} · CareBridge ops`;
  }, [props.title]);

  return (
    <div className={cx('screen', props.wide && 'wide')}>
      <div className="screen-toolbar">
        <h1>{props.title}</h1>
        <div className="toolbar-actions">{props.actions}</div>
      </div>
      {props.children}
    </div>
  );
}

export function RefreshButton(props: { onClick: () => void; loading?: boolean }) {
  return (
    <Button variant="text" icon={RefreshCw} onClick={props.onClick} busy={props.loading}>
      Refresh
    </Button>
  );
}
