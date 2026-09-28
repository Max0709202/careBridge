/**
 * Toasts and dialogs — the web's SnackBar, AlertDialog and bottom sheet.
 */
import { CircleAlert, CircleCheck } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Failure, failureMessage } from '../api/failures';
import { useStore } from '../state/context';
import { Button } from './ui';

// ─── toasts ─────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  kind: 'error' | 'success';
  message: string;
}

interface Feedback {
  showFailure(error: unknown): void;
  showConfirmation(message: string): void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const store = useStore();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const show = useCallback((kind: Toast['kind'], message: string, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    counter.current += 1;
    setToast({ id: counter.current, kind, message });
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const value: Feedback = {
    /**
     * Only a Failure's message is ever shown — generic, and identical for "not
     * found" and "not permitted", so it cannot be used to probe for records.
     */
    showFailure: (error) => {
      show('error', failureMessage(error), 5_000);
      // A refresh that failed has already cleared the tokens; leaving the
      // screens up would only produce more of the same error. Drop to sign-in.
      if (error instanceof Failure && error.kind === 'authentication' && !store.api.tokens.read()) {
        store.forgetSession();
      }
    },
    showConfirmation: (message) => show('success', message, 4_000),
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            {toast.kind === 'error' ? <CircleAlert size={22} aria-hidden /> : <CircleCheck size={22} aria-hidden />}
            <span className="grow">{toast.message}</span>
          </div>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('FeedbackProvider is missing');
  return feedback;
}

// ─── dialogs ────────────────────────────────────────────────────────────────

/**
 * A modal. `sheet` makes it a bottom sheet on a phone and a dialog on anything
 * wider. Escape and a click on the scrim both dismiss, as on the app.
 */
export function Modal(props: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref so an inline `onClose` does not re-run the mount effect on
  // every render — which would move focus back to the first field mid-typing.
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (first ?? ref.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose.current();
      if (e.key === 'Tab' && ref.current) trapFocus(ref.current, e);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className={`scrim${props.sheet ? ' sheet' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose.current();
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.labelledBy ? undefined : props.title}
        aria-labelledby={props.labelledBy}
        tabIndex={-1}
      >
        {props.title && <h2>{props.title}</h2>}
        {props.children}
      </div>
    </div>
  );
}

function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]',
    ),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) {
    last.focus();
    e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus();
    e.preventDefault();
  }
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * Confirmation before anything destructive or outward-facing. The confirming
 * button says what will happen rather than "OK".
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(
    null,
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const close = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const dismiss = useCallback(() => close(false), [close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal title={pending.title} onClose={dismiss}>
          <p className="t-body-lg pre">{pending.message}</p>
          <div className="dialog-actions">
            <Button variant="text" onClick={() => close(false)}>
              {pending.cancelLabel ?? 'Keep it'}
            </Button>
            <Button
              variant={pending.destructive === false ? 'filled' : 'danger'}
              onClick={() => close(true)}
            >
              {pending.confirmLabel}
            </Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('ConfirmProvider is missing');
  return confirm;
}
