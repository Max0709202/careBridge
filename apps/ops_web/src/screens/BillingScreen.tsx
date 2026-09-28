import { CircleAlert, CreditCard, Info, Package, ReceiptText } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Modal, useConfirm } from '../components/feedback';
import { SubscriptionPill } from '../components/pills';
import {
  Button,
  Card,
  EmptyState,
  KeyValue,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  SectionHeader,
  StaleBanner,
  TextField,
} from '../components/ui';
import { useRun } from '../components/useRun';
import { formatDay, formatDayTime } from '../core/format';
import { formatCents } from '../core/money';
import {
  hasExpired,
  hasFailed,
  intervalCadence,
  intervalLabel,
  invoiceReasonLabel,
  invoiceStatusLabel,
  isCancelling,
  isPayable,
  isTrialing,
  paymentMethodLabel,
  willBillWithoutACard,
  type BillingAccount,
  type BillingInterval,
  type BillingLine,
  type Invoice,
  type OperatorPlan,
  type OperatorSubscription,
  type PaymentMethod,
} from '../domain/billing';
import { useOperatorId, useResource, useStore } from '../state/context';
import { keys } from '../state/opsStore';

/**
 * What this operator pays for the console, the driver app and assignment. A
 * port of apps/ops_console/lib/features/billing/billing_screen.dart.
 *
 * The **second** payer (ADR-0011). The Seats screen answers "why eleven
 * drivers"; this one answers "billed for what, on what cadence, against which
 * card, and what happens if it bounces". Nothing about a price is compiled in:
 * the catalogue is rows on the server.
 */
export function BillingScreen() {
  const store = useStore();
  const organizationId = useOperatorId();
  const account = useResource(keys.billing(organizationId), (api) => api.billing(organizationId));

  let body;
  if (account.value) {
    body = (
      <>
        {account.error ? <StaleBanner error={account.error} onRetry={account.reload} /> : null}
        <BillingBody organizationId={organizationId} account={account.value} />
      </>
    );
  } else if (account.error) {
    body = <LoadFailure title="Could not load billing" onRetry={account.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen title="Billing" actions={<RefreshButton onClick={() => store.invalidateBilling(organizationId)} />}>
      {body}
    </Screen>
  );
}

function BillingBody({ organizationId, account }: { organizationId: string; account: BillingAccount }) {
  const store = useStore();
  const confirm = useConfirm();
  const { run, busy } = useRun();
  const [addingCard, setAddingCard] = useState(false);
  const subscription = account.subscription;

  /**
   * Runs one billing action and refreshes all three of account, invoices and
   * seats: subscribing writes an invoice, changing interval credits one period
   * and issues another, paying changes what is owed. Refreshing only the
   * obvious one shows two figures that disagree.
   */
  async function act(action: () => Promise<unknown>) {
    const result = await run(() => store.guard(action));
    if (result.ok) store.invalidateBilling(organizationId);
    return result.ok;
  }

  async function changeInterval(current: BillingInterval) {
    const next: BillingInterval = current === 'monthly' ? 'annual' : 'monthly';
    // Said before it happens, because the money moves immediately.
    const ok = await confirm({
      title: `Switch to ${intervalLabel[next].toLowerCase()} billing`,
      message:
        'The unused remainder of the current period is credited and a fresh period starts today. If the credit is larger than the new period, the difference is carried against future renewals rather than refunded.',
      cancelLabel: 'Keep as it is',
      confirmLabel: 'Switch',
      destructive: false,
    });
    if (ok) await act(() => store.api.changeInterval(organizationId, next));
  }

  async function cancelPlan() {
    const ok = await confirm({
      title: 'Cancel this subscription',
      message:
        'Not a refund and not an immediate switch-off: the console, the driver app and assignment keep working until the end of the period that has been paid for. After that this operator falls back to a per-fare margin.',
      cancelLabel: 'Keep the plan',
      confirmLabel: 'Cancel at period end',
    });
    if (ok) await act(() => store.api.cancelSubscription(organizationId));
  }

  async function removeCard(card: PaymentMethod) {
    const ok = await confirm({
      title: 'Remove this card',
      message: `Renewals will have nothing to charge until another card is added. ${paymentMethodLabel(card)} stays named on the payments it already made.`,
      cancelLabel: 'Keep it',
      confirmLabel: 'Remove',
    });
    if (ok) await act(() => store.api.detachPaymentMethod(organizationId, card.id));
  }

  return (
    <>
      {subscription ? (
        <PlanCard
          subscription={subscription}
          busy={busy}
          onChangeInterval={() => void changeInterval(subscription.interval)}
          onCancel={() => void cancelPlan()}
        />
      ) : (
        <Card>
          <h2 className="t-title">No plan</h2>
          <p className="mt-xs">
            This operator is not on a subscription. Without one the platform takes a margin on each fare instead — an
            operator paying by seats keeps the whole fare, and charging both would be charging twice for one
            relationship.
          </p>
        </Card>
      )}

      <SectionHeader title="Card on file" />
      <CardOnFile account={account} busy={busy} onAdd={() => setAddingCard(true)} onRemove={(c) => void removeCard(c)} />

      {!subscription && (
        <>
          <SectionHeader title="Plans" />
          <Catalogue
            busy={busy}
            onSubscribe={(plan) =>
              void act(() =>
                store.api.subscribe({ organizationId, planCode: plan.code, interval: plan.interval }),
              )
            }
          />
        </>
      )}

      <SectionHeader title="Invoices" />
      <Invoices
        organizationId={organizationId}
        busy={busy}
        onPay={(invoice) => void act(() => store.api.payInvoice(organizationId, invoice.id))}
      />

      {addingCard && (
        <PaymentTokenDialog
          onCancel={() => setAddingCard(false)}
          onSave={async (token) => {
            if (await act(() => store.api.attachPaymentMethod(organizationId, token))) setAddingCard(false);
          }}
          busy={busy}
        />
      )}
    </>
  );
}

// ─── the plan ───────────────────────────────────────────────────────────────

function PlanCard(props: {
  subscription: OperatorSubscription;
  busy: boolean;
  onChangeInterval: () => void;
  onCancel: () => void;
}) {
  const { subscription } = props;
  const quote = subscription.renewalQuote;

  return (
    <Card>
      <div className="row">
        <h2 className="t-title grow">{subscription.planName}</h2>
        <SubscriptionPill status={subscription.status} />
      </div>
      <div className="mt-sm">
        <KeyValue
          label="Billing period"
          value={`${intervalLabel[subscription.interval]} · renews ${formatDay(subscription.currentPeriodEnd)}`}
        />
        <KeyValue label="Drivers billed" value={subscription.seats} />
        <KeyValue label="Next renewal" value={formatCents(quote.totalCents)} />
        {subscription.carriedCreditCents > 0 && (
          <KeyValue label="Credit carried" value={formatCents(subscription.carriedCreditCents)} />
        )}
      </div>
      {/* Itemised: "why is it $412?" is answered by the lines rather than a support conversation. */}
      <Lines lines={quote.lines} />

      {isTrialing(subscription) && subscription.trialEndsAt && (
        <BillingNote>
          The free trial ends on {formatDay(subscription.trialEndsAt)}. The card on file is charged then.
        </BillingNote>
      )}
      {subscription.status === 'pastDue' && (
        <BillingNote emphasis>
          A payment failed. The console keeps working for the plan’s grace window — the point of that window is that
          somebody finds out by being told rather than by a shift that stops.
        </BillingNote>
      )}
      {isCancelling(subscription) && (
        <BillingNote>
          Cancelled. Everything keeps working until {formatDay(subscription.currentPeriodEnd)}, because that period is
          paid for.
        </BillingNote>
      )}

      {!isCancelling(subscription) && (
        <div className="actions-row">
          <Button variant="outlined" disabled={props.busy} onClick={props.onChangeInterval}>
            {subscription.interval === 'monthly' ? 'Switch to yearly' : 'Switch to monthly'}
          </Button>
          <Button variant="text" disabled={props.busy} onClick={props.onCancel}>
            Cancel plan
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── the card ───────────────────────────────────────────────────────────────

/**
 * Shown whether or not one exists, because the **absence** is the more
 * important state: a subscription with no card is one renewal from dunning.
 */
function CardOnFile(props: {
  account: BillingAccount;
  busy: boolean;
  onAdd: () => void;
  onRemove: (card: PaymentMethod) => void;
}) {
  const card = props.account.paymentMethod;
  return (
    <Card>
      {card ? (
        <>
          <div className="row">
            <CreditCard size={20} aria-hidden />
            <span className="t-body-lg grow">{paymentMethodLabel(card)}</span>
            <span className="t-small muted">
              Expires {String(card.expMonth).padStart(2, '0')}/{card.expYear}
            </span>
          </div>
          {hasExpired(card, new Date()) && <BillingNote emphasis>This card has expired.</BillingNote>}
        </>
      ) : (
        <p className="t-body-lg">No card on file.</p>
      )}
      {willBillWithoutACard(props.account) && (
        <BillingNote emphasis>
          This subscription will bill a card that is not there. Add one before the period ends.
        </BillingNote>
      )}
      {props.account.amountDueCents > 0 && (
        <BillingNote emphasis>Outstanding: {formatCents(props.account.amountDueCents)}</BillingNote>
      )}
      <div className="actions-row">
        <Button icon={CreditCard} disabled={props.busy} onClick={props.onAdd}>
          {card ? 'Replace the card' : 'Add a card'}
        </Button>
        {card && (
          <Button variant="text" disabled={props.busy} onClick={() => props.onRemove(card)}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}

// ─── the catalogue ──────────────────────────────────────────────────────────

function Catalogue(props: { busy: boolean; onSubscribe: (plan: OperatorPlan) => void }) {
  // Not keyed by organisation: the catalogue is the same for every operator.
  const plans = useResource(keys.plans, (api) => api.plans());

  if (!plans.value) {
    return plans.error ? <LoadFailure title="Could not load the plans" onRetry={plans.reload} /> : <LoadingBlock />;
  }
  if (plans.value.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No plans published"
        message="The operator catalogue is empty. Nothing can be subscribed to until a plan row exists."
      />
    );
  }
  return (
    <ul className="list">
      {plans.value.map((plan) => (
        <li key={`${plan.code}/${plan.interval}`}>
          <PlanOffer plan={plan} busy={props.busy} onSubscribe={() => props.onSubscribe(plan)} />
        </li>
      ))}
    </ul>
  );
}

function PlanOffer(props: { plan: OperatorPlan; busy: boolean; onSubscribe: () => void }) {
  const { plan } = props;
  return (
    <Card>
      <div className="row">
        <h3 className="t-title grow">{plan.name}</h3>
        <span className="t-title">
          {formatCents(plan.basePriceCents)} {intervalCadence[plan.interval]}
        </span>
      </div>
      <p className="mt-xs">{plan.description}</p>
      <p className="t-small mt-sm">
        {plan.includedSeats > 0
          ? `Covers ${plan.includedSeats} driver(s); above that the graduated ladder applies.`
          : 'Every driver is priced on the graduated ladder.'}
      </p>
      {plan.seatTiers.map((tier, index) => (
        <p key={index} className="t-small muted">
          {tier.upToSeats === null
            ? `Beyond that: ${formatCents(tier.unitPriceCents)} per driver`
            : `Up to ${tier.upToSeats} drivers: ${formatCents(tier.unitPriceCents)} each`}
        </p>
      ))}
      {/* The answers to "can we try it" and "what if the card bounces" belong where they are asked. */}
      <p className="t-small mt-xs">
        {plan.trialDays > 0 ? `${plan.trialDays}-day free trial. ` : ''}A failed payment keeps working for{' '}
        {plan.graceDays} day(s).
      </p>
      {plan.entitlements.length > 0 && <p className="t-small muted mt-xs">Includes: {plan.entitlements.join(', ')}</p>}
      <div className="actions-row">
        <Button disabled={props.busy} onClick={props.onSubscribe}>
          Subscribe {intervalLabel[plan.interval].toLowerCase()}
        </Button>
      </div>
    </Card>
  );
}

// ─── invoices ───────────────────────────────────────────────────────────────

function Invoices(props: { organizationId: string; busy: boolean; onPay: (invoice: Invoice) => void }) {
  const invoices = useResource(keys.invoices(props.organizationId), (api) => api.invoices(props.organizationId));

  if (!invoices.value) {
    return invoices.error ? (
      <LoadFailure title="Could not load invoices" onRetry={invoices.reload} />
    ) : (
      <LoadingBlock />
    );
  }
  if (invoices.value.length === 0) {
    return <EmptyState icon={ReceiptText} title="Nothing billed yet" message="Invoices appear here as periods renew." />;
  }
  return (
    <ul className="list">
      {invoices.value.map((invoice) => (
        <li key={invoice.id}>
          <InvoiceCard invoice={invoice} busy={props.busy} onPay={() => props.onPay(invoice)} />
        </li>
      ))}
    </ul>
  );
}

function InvoiceCard(props: { invoice: Invoice; busy: boolean; onPay: () => void }) {
  const { invoice } = props;
  return (
    <Card>
      <div className="row">
        <span className="t-body-lg grow">
          {invoice.number} · {invoiceReasonLabel[invoice.reason]}
        </span>
        <span className="t-body-lg">{formatCents(invoice.totalCents)}</span>
      </div>
      <p className="t-small muted">
        {invoiceStatusLabel[invoice.status]} · issued {formatDay(invoice.issuedAt)}
      </p>
      {/* Read back off the invoice, so a bill from eight months ago shows the prices it charged. */}
      <Lines lines={invoice.lines} />
      {invoice.creditAppliedCents > 0 && (
        <KeyValue small label="Credit applied" value={`-${formatCents(invoice.creditAppliedCents)}`} />
      )}
      {hasFailed(invoice) && (
        <BillingNote emphasis>
          {invoice.nextAttemptAt
            ? `Payment failed ${invoice.attemptCount} time(s). Next attempt ${formatDayTime(invoice.nextAttemptAt)}.`
            : `Payment failed ${invoice.attemptCount} time(s). No further attempt is scheduled.`}
        </BillingNote>
      )}
      {/* For the moment after a declined card is replaced: waiting a day for the retry reads as the fix not working. */}
      {isPayable(invoice) && (
        <div className="actions-row">
          <Button variant="outlined" disabled={props.busy} onClick={props.onPay}>
            Pay now
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── shared bits ────────────────────────────────────────────────────────────

function Lines({ lines }: { lines: BillingLine[] }) {
  return (
    <div className="lines mt-sm">
      {lines.map((line, index) => (
        <KeyValue
          key={index}
          small
          label={line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label}
          value={formatCents(line.amountCents)}
        />
      ))}
    </div>
  );
}

function BillingNote({ children, emphasis }: { children: ReactNode; emphasis?: boolean }) {
  return (
    <p className={`note t-small${emphasis ? ' emphasis' : ''}`}>
      {emphasis ? <CircleAlert size={16} aria-hidden /> : <Info size={16} aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

/**
 * Where a card is put on file without a card number reaching this process.
 *
 * ADR-0006 puts that boundary at the client: the intended surface is the
 * processor's own card element, which hands back a token. That is not wired up
 * yet, so this dialog takes **the token itself** — exactly what the API accepts
 * and exactly what the processor will supply. Replacing this dialog is then
 * the whole change; no endpoint moves. Asking for a card number here "only in
 * development" is how it ends up in production.
 */
function PaymentTokenDialog(props: { busy: boolean; onCancel: () => void; onSave: (token: string) => void }) {
  const [token, setToken] = useState('');
  const trimmed = token.trim();
  return (
    <Modal title="Add a card" onClose={props.onCancel}>
      <form
        className="stack gap-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) props.onSave(trimmed);
        }}
      >
        <p>
          CareBridge never sees a card number. The payment processor takes the card and hands back a token; that token
          is what this field wants and what the API stores.
        </p>
        <TextField
          label="Processor token"
          placeholder="tok_…"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {/* The local adapter's unhappy paths are unreachable if nobody is told which digits produce them. */}
        <p className="t-small muted">
          Against the local payments adapter any string works, and its last four digits choose the outcome — Stripe’s
          own test-card meanings: 4242 settles, 9995 is declined for insufficient funds, 9979 is reported stolen.
        </p>
        <div className="dialog-actions">
          <Button variant="text" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed} busy={props.busy}>
            Save the card
          </Button>
        </div>
      </form>
    </Modal>
  );
}
