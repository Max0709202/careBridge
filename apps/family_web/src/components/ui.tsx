/**
 * Shared building blocks. Ports of lib/widgets/common.dart and status_pill.dart.
 */
import { ArrowLeft, SearchX, type LucideIcon } from 'lucide-react';
import {
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { useGoBack } from './navigation';

export type Ink = 'positive' | 'caution' | 'critical' | 'info' | 'neutral';

const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(' ');

// ─── cards ──────────────────────────────────────────────────────────────────

/** A bordered content card; a button when it has an `onClick`. */
export function AppCard(props: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  border?: Ink | 'primary' | 'outline';
  flush?: boolean;
  className?: string;
}) {
  const className = cx(
    'card',
    props.flush && 'flush',
    props.border && `accent border-${props.border}`,
    props.className,
  );
  if (props.onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={props.onClick}
        aria-label={props.ariaLabel}
      >
        {props.children}
      </button>
    );
  }
  return (
    <section className={className} aria-label={props.ariaLabel}>
      {props.children}
    </section>
  );
}

export function SectionHeader(props: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="grow">
        <h2>{props.title}</h2>
        {props.subtitle && <p className="t-small muted">{props.subtitle}</p>}
      </div>
      {props.action}
    </div>
  );
}

/**
 * Empty states explain what to do next rather than announcing an empty list.
 */
export function EmptyState(props: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
  fill?: boolean;
}) {
  const Icon = props.icon;
  return (
    <div className={cx('empty', props.fill && 'fill')}>
      <Icon className="empty-icon" size={56} aria-hidden />
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      {props.action && <div className="empty-action">{props.action}</div>}
    </div>
  );
}

/** The shared "no such record, or not yours" screen — deliberately identical for both. */
export function NotAvailable() {
  return (
    <Page title="">
      <EmptyState
        fill
        icon={SearchX}
        title="Not available"
        message="We could not find that, or you do not have access to it."
      />
    </Page>
  );
}

export function InfoRow(props: {
  label: string;
  value: string;
  icon?: LucideIcon;
  valueClass?: string;
}) {
  const Icon = props.icon;
  return (
    <div className="info-row">
      {Icon && <Icon className="info-icon" size={20} aria-hidden />}
      <div className="grow">
        <div className="info-label">{props.label}</div>
        <div className={cx('info-value', props.valueClass)}>{props.value}</div>
      </div>
    </div>
  );
}

export function Divider() {
  return <hr className="divider" />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="progressbar" aria-label={label} />;
}

export function Avatar({ text, size }: { text: string; size?: 'md' | 'lg' | 'xl' }) {
  return (
    <span className={cx('avatar', size)} aria-hidden>
      {text}
    </span>
  );
}

// ─── status ─────────────────────────────────────────────────────────────────

/** Never colour alone: every pill carries an icon *and* a word (WCAG 1.4.1). */
export function StatusPill(props: {
  label: string;
  icon: LucideIcon;
  ink: Ink;
  outlined?: boolean;
}) {
  const Icon = props.icon;
  return (
    <span
      className={cx(
        'pill',
        `ink-${props.ink}`,
        `bg-${props.ink}`,
        props.outlined && 'outlined',
      )}
      role="status"
      aria-label={`Status: ${props.label}`}
    >
      <Icon size={17} aria-hidden />
      <span>{props.label}</span>
    </span>
  );
}

export function Banner(props: { ink: Ink; icon: LucideIcon; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <div className={cx('banner', `bg-${props.ink}`, `ink-${props.ink}`)}>
      <Icon size={22} aria-hidden style={{ flex: '0 0 auto' }} />
      <div className="grow">{props.children}</div>
    </div>
  );
}

// ─── buttons ────────────────────────────────────────────────────────────────

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'outlined-danger';

export function Button({
  variant = 'filled',
  icon: Icon,
  block,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  icon?: LucideIcon;
  block?: boolean;
}) {
  const variantClass =
    variant === 'outlined-danger' ? 'btn-outlined danger' : `btn-${variant}`;
  return (
    <button
      type="button"
      className={cx('btn', variantClass, block && 'block', className)}
      {...rest}
    >
      {Icon && <Icon size={20} aria-hidden />}
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
      <Icon size={22} aria-hidden />
    </button>
  );
}

// ─── form fields ────────────────────────────────────────────────────────────

interface FieldChrome {
  label: string;
  helper?: string;
  error?: string | null;
}

export function TextField({
  label,
  helper,
  error,
  multiline,
  rows,
  trailing,
  ...input
}: FieldChrome &
  InputHTMLAttributes<HTMLInputElement> & {
    multiline?: boolean;
    rows?: number;
    trailing?: ReactNode;
  }) {
  const id = useId();
  const described = `${id}-desc`;
  return (
    <div className={cx('field', error && 'invalid')}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows ?? 3}
          aria-invalid={!!error}
          aria-describedby={described}
          {...(input as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : trailing ? (
        <div className="input-affix">
          <input
            id={id}
            aria-invalid={!!error}
            aria-describedby={described}
            {...input}
          />
          {trailing}
        </div>
      ) : (
        <input id={id} aria-invalid={!!error} aria-describedby={described} {...input} />
      )}
      <div id={described}>
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

export function SelectField({
  label,
  helper,
  error,
  children,
  ...select
}: FieldChrome & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={cx('field', error && 'invalid')}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        aria-invalid={!!error}
        aria-describedby={`${id}-desc`}
        {...select}
      >
        {children}
      </select>
      <div id={`${id}-desc`}>
        {error ? (
          <div className="field-error">{error}</div>
        ) : (
          helper && <div className="helper">{helper}</div>
        )}
      </div>
    </div>
  );
}

export function Switch(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="track" aria-hidden>
        <span className="thumb" />
      </span>
    </span>
  );
}

/** A labelled switch row, as a SwitchListTile. */
export function SwitchRow(props: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  leading?: ReactNode;
}) {
  return (
    <label className="switch-row">
      {props.leading}
      <span className="grow">
        <span className="t-body-lg" style={{ fontWeight: 600, display: 'block' }}>
          {props.title}
        </span>
        {props.subtitle && <span className="t-body muted">{props.subtitle}</span>}
      </span>
      <Switch
        label={props.title}
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.disabled}
      />
    </label>
  );
}

export function CheckboxRow(props: {
  checked: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <label className={cx('check-row', props.disabled && 'disabled')}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange?.(e.target.checked)}
      />
      <span className="grow">
        <span className="t-body" style={{ display: 'block' }}>
          {props.title}
        </span>
        {props.subtitle && <span className="t-small muted">{props.subtitle}</span>}
      </span>
    </label>
  );
}

// ─── page chrome ────────────────────────────────────────────────────────────

/**
 * A screen: a sticky top bar and a readable-width body. `back` shows the back
 * arrow, as a pushed route does.
 */
export function Page(props: {
  title: string;
  back?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  narrow?: boolean;
  bare?: boolean;
  below?: ReactNode;
}) {
  const goBack = useGoBack();
  const scrolled = useScrolled();

  useEffect(() => {
    document.title = props.title ? `${props.title} · CareBridge` : 'CareBridge';
  }, [props.title]);

  return (
    <>
      {!props.bare && (
        <header className={cx('top-bar', scrolled && 'scrolled')}>
          {props.back && (
            <IconButton
              className="back"
              icon={ArrowLeft}
              label="Back"
              onClick={goBack}
            />
          )}
          <h1>{props.title}</h1>
          {props.actions}
        </header>
      )}
      {props.below}
      <main className={cx('screen-body', props.narrow && 'narrow')}>
        {props.children}
      </main>
    </>
  );
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}
