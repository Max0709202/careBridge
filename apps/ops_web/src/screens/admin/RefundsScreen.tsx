import { CircleAlert, CircleCheck, Clock, History, SearchX, Undo2, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { failureMessage } from '../../api/failures';
import { Modal } from '../../components/feedback';
import { Button, Card, EmptyState, KeyValue, Screen, SectionHeader, TextArea, TextField } from '../../components/ui';
import { useRun } from '../../components/useRun';
import { formatDayTime } from '../../core/format';
import { centsToInput, formatCents, parseDollars } from '../../core/money';
import {
  hasInFlightRefund,
  isFullyRefunded,
  refundedCents,
  refundStatusLabel,
  type Refund,
  type RefundableInvoice,
  type RefundStatus,
} from '../../domain/admin';
import { useStore } from '../../state/context';

/**
 * Sending money back. A port of
 * apps/ops_console/lib/features/admin/refunds_screen.dart.
 *
 * It opens on a lookup rather than a list: a refund is issued against **one
 * invoice** somebody is already looking at, and no endpoint lists invoices
 * across every account. Before the amount field it shows what is left, what
 * was already refunded, and whether a refund is still in flight — the three
 * facts that prevent a duplicate credit.
 */
export function RefundsScreen() {
  const store = useStore();
  const [invoiceId, setInvoiceId] = useState('');
  const [invoice, setInvoice] = useState<RefundableInvoice | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refunding, setRefunding] = useState(false);

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    const id = invoiceId.trim();
    if (!id) return;
    setLooking(true);
    setError(null);
    setInvoice(null);
    try {
      setInvoice(await store.guard(() => store.api.refundable(id)));
    } catch (failure) {
      setError(failure);
    } finally {
      setLooking(false);
    }
  }

  return (
    <Screen title="Refunds">
      <Card>
        <h2 className="t-title">Find an invoice</h2>
        <form className="lookup mt-sm" onSubmit={(e) => void lookUp(e)}>
          <TextField
            className="grow"
            label="Invoice id"
            helper="The identifier, not the printed number — it is on the invoice the payer is looking at."
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
          />
          <Button type="submit" busy={looking}>
            {looking ? 'Looking…' : 'Look up'}
          </Button>
        </form>
      </Card>

      {error !== null && (
        // The shared message: "no such invoice", "nothing was paid on it" and
        // "not yours" are answered the same way, and this screen must not
        // invent a distinction it was not given.
        <EmptyState icon={SearchX} title="Nothing to refund there" message={failureMessage(error)} />
      )}

      {invoice && (
        <>
          <Summary invoice={invoice} onRefund={() => setRefunding(true)} />
          <SectionHeader title="Already refunded" />
          {invoice.refunds.length === 0 ? (
            <EmptyState icon={History} title="Nothing yet" message="No credit has been issued against this payment." />
          ) : (
            <ul className="list">
              {invoice.refunds.map((refund) => (
                <li key={refund.id}>
                  <RefundRow refund={refund} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {refunding && invoice && (
        <RefundDialog
          invoice={invoice}
          onClose={(updated) => {
            setRefunding(false);
            if (updated) setInvoice(updated);
          }}
        />
      )}
    </Screen>
  );
}

function Summary({ invoice, onRefund }: { invoice: RefundableInvoice; onRefund: () => void }) {
  return (
    <Card className="mt-md">
      <h2 className="t-title">Invoice {invoice.invoiceNumber}</h2>
      <div className="mt-sm">
        <KeyValue label="Paid" value={formatCents(invoice.paidCents)} />
        <KeyValue label="Already refunded" value={formatCents(refundedCents(invoice))} />
        <KeyValue label="Left to refund" value={formatCents(invoice.refundableCents)} />
      </div>
      {hasInFlightRefund(invoice) && (
        <p className="note t-small">
          <Clock size={16} className="ink-imminent" aria-hidden />
          <span>A refund is still in flight. Wait for it to settle before issuing another, or the account is credited twice.</span>
        </p>
      )}
      <div className="actions-row">
        {isFullyRefunded(invoice) ? (
          <p>Everything paid on this invoice has been refunded.</p>
        ) : (
          <Button icon={Undo2} onClick={onRefund}>
            Refund
          </Button>
        )}
      </div>
    </Card>
  );
}

const refundLook: Record<RefundStatus, [LucideIcon, string]> = {
  succeeded: [CircleCheck, 'ink-positive'],
  pending: [Clock, 'ink-imminent'],
  failed: [CircleAlert, 'ink-overdue'],
};

function RefundRow({ refund }: { refund: Refund }) {
  const [Icon, ink] = refundLook[refund.status];
  return (
    <Card>
      <div className="row">
        {/* Icon and word, never colour alone. */}
        <Icon size={18} className={ink} aria-hidden />
        <span className="t-body-lg grow">
          {formatCents(refund.amountCents)} · {refundStatusLabel[refund.status]}
        </span>
        <span className="t-small muted">{formatDayTime(refund.createdAt)}</span>
      </div>
      <p className="mt-xs">{refund.reason}</p>
      <p className="t-small muted">Asked for by {refund.requestedByName}</p>
      {refund.failureMessage && <p className="t-small error-text mt-xs">{refund.failureMessage}</p>}
    </Card>
  );
}

/** The amount and the reason, with the ceiling enforced before it is sent. */
function RefundDialog(props: { invoice: RefundableInvoice; onClose: (updated?: RefundableInvoice) => void }) {
  const { invoice } = props;
  const store = useStore();
  const { run, busy } = useRun();
  // The whole remaining balance: a full refund is the common case, and typing
  // the figure again is a chance to mistype it.
  const [amount, setAmount] = useState(centsToInput(invoice.refundableCents));
  const [reason, setReason] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);

  async function issue(e: FormEvent) {
    e.preventDefault();
    const cents = parseDollars(amount);
    const problem =
      cents === null
        ? 'Enter an amount, like 24.50.'
        : cents <= 0
          ? 'A refund has to be more than nothing.'
          : cents > invoice.refundableCents
            ? `Only ${formatCents(invoice.refundableCents)} is left on this payment.`
            : null;
    setAmountError(problem);
    if (problem !== null || cents === null || reason.trim().length < 3) return;

    const result = await run(() =>
      store.guard(() =>
        store.api.issueRefund({
          invoiceId: invoice.invoiceId,
          // Carried from the lookup, so the credit lands on the payment that was on screen.
          paymentId: invoice.paymentId,
          amountCents: cents,
          reason,
        }),
      ),
    );
    if (result.ok) props.onClose(result.value);
  }

  return (
    <Modal title={`Refund invoice ${invoice.invoiceNumber}`} onClose={() => props.onClose()}>
      <form className="stack gap-sm" onSubmit={(e) => void issue(e)} noValidate>
        <TextField
          label="Amount"
          prefix="$"
          inputMode="decimal"
          value={amount}
          error={amountError}
          helper={`${formatCents(invoice.refundableCents)} left on this payment.`}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(null);
          }}
        />
        <TextArea
          label="Why"
          helper="An unexplained credit is something somebody has to justify to an accountant a quarter later."
          counter={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="t-small muted">
          The refund is recorded here before the processor is called, so a credit that succeeded externally and failed
          to record is still explicable.
        </p>
        <div className="dialog-actions">
          <Button variant="text" disabled={busy} onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button type="submit" busy={busy} disabled={reason.trim().length < 3}>
            {busy ? 'Sending…' : 'Send the money back'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
