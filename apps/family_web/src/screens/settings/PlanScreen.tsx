import { CircleCheck, CloudOff, CreditCard, RefreshCw, WalletCards } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { invoiceFromJson, paymentMethodFromJson, planFromJson, subscriptionFromJson } from '../../api/codec';
import { Modal } from '../../components/feedback';
import { useRun } from '../../components/useRun';
import {
  AppCard,
  Button,
  Divider,
  EmptyState,
  IconButton,
  InfoRow,
  Page,
  SectionHeader,
  Spinner,
  TextField,
} from '../../components/ui';
import { formatDay } from '../../core/formatting';
import { formatMoney } from '../../core/money';
import {
  cardExpiresSoon,
  cardHasExpired,
  DunningCopy,
  entitlementLabel,
  intervalCadence,
  intervalLabel,
  invoiceCanBePaidNow,
  invoiceIsOutstanding,
  invoiceReasonLabel,
  invoiceStatusLabel,
  paymentMethodLabel,
  periodPriceCents,
  subscriptionNeedsAttention,
  subscriptionSummary,
  type Invoice,
  type PaymentMethod,
  type Subscription,
  type SubscriptionPlan,
} from '../../domain/billing';
import { useApi } from '../../state/context';

interface Loaded {
  subscription: Subscription | null;
  plans: SubscriptionPlan[];
  invoices: Invoice[];
  card: PaymentMethod | null;
  amountDueCents: number;
}

/**
 * What this household pays, and what it buys. The whole catalogue comes from
 * the server; nothing about a price or an entitlement is compiled in. The
 * screen also says what the *other* payer covers, because "why is there a
 * subscription and a fare" deserves an honest answer.
 */
export function PlanScreen() {
  const api = useApi();
  const { run, busy } = useRun();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'addCard' | 'removeCard' | 'cancelPlan' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const account = await api.billingAccount();
      const plans = await api.billingPlans();
      // Only once we know there is an account: a household with none can only
      // have an empty list.
      const invoices = account ? await api.invoices() : [];
      setData({
        subscription: subscriptionFromJson(account?.subscription),
        plans: plans.map(planFromJson).filter((p): p is SubscriptionPlan => p !== null),
        invoices: invoices.map(invoiceFromJson).filter((i): i is Invoice => i !== null),
        card: paymentMethodFromJson(account?.paymentMethod),
        amountDueCents: account?.amountDueCents ?? 0,
      });
    } catch (e) {
      setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every change reloads the whole account, so the screen shows what the server now says. */
  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      await load();
    });

  let body;
  if (error !== null) {
    body = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load your plan"
          message="Check your connection and try again."
          action={<Button variant="outlined" onClick={load}>Retry</Button>}
        />
      </AppCard>
    );
  } else if (data === null) {
    body = <Spinner />;
  } else {
    const { subscription, plans, invoices, card, amountDueCents } = data;
    body = (
      <div className="stack">
        {subscription === null ? (
          <AppCard>
            <EmptyState
              icon={CreditCard}
              title="No plan yet"
              message="Choose a plan to book transportation and follow trips as they happen."
            />
          </AppCard>
        ) : (
          <>
            <CurrentPlan subscription={subscription} busy={busy} onCancel={() => setDialog('cancelPlan')} />
            <SwitchInterval
              subscription={subscription}
              plans={plans}
              busy={busy}
              onSwitch={(interval) => act(() => api.changeBillingInterval(interval))}
            />
            <div className="mt-lg">
              <PaymentMethodCard
                card={card}
                amountDueCents={amountDueCents}
                busy={busy}
                onAdd={() => setDialog('addCard')}
                onRemove={() => setDialog('removeCard')}
              />
            </div>
          </>
        )}

        {invoices.length > 0 && (
          <div className="mt-lg">
            <SectionHeader title="Invoices" />
            <div className="stack gap-sm">
              {invoices.map((invoice) => (
                <InvoiceCard
                  key={invoice.id}
                  invoice={invoice}
                  busy={busy}
                  onPay={() => act(() => api.payInvoice(invoice.id))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-lg">
          <SectionHeader title="Plans" />
          <div className="stack gap-sm">
            {plans.map((plan) => (
              <PlanCard
                key={`${plan.code}-${plan.interval}`}
                plan={plan}
                subscription={subscription}
                busy={busy}
                onChoose={() => act(() => api.subscribe(plan.code, plan.interval))}
              />
            ))}
          </div>
        </div>

        <AppCard className="mt-md">
          <p className="t-title-sm">What the fare covers</p>
          <p className="t-body muted mt-xs">
            Your plan pays for the coordination — booking, tracking, reminders and the care circle.
            Each trip is charged separately, and that fare goes to the transport company that drives
            it. They pay us for the drivers they run, so we do not also take a cut of what you pay them.
          </p>
        </AppCard>
      </div>
    );
  }

  return (
    <Page title="Your plan" back actions={<IconButton icon={RefreshCw} label="Refresh" onClick={load} />}>
      {body}

      {dialog === 'addCard' && (
        <PaymentTokenDialog
          onClose={(token) => {
            setDialog(null);
            if (token) void act(() => api.attachPaymentMethod(token));
          }}
        />
      )}

      {dialog === 'removeCard' && data?.card && (
        <Modal title="Remove this card?" onClose={() => setDialog(null)}>
          {/* Both halves said plainly: what happens next, and what does not change. */}
          <p className="t-body-lg pre">
            {`Your plan will have nothing to charge when it next renews, and it will lapse unless you add another card first.\n\n${paymentMethodLabel(data.card)} stays on the payments it already made.`}
          </p>
          <div className="dialog-actions">
            <Button variant="text" onClick={() => setDialog(null)}>
              Keep it
            </Button>
            <Button
              onClick={() => {
                const id = data.card!.id;
                setDialog(null);
                void act(() => api.detachPaymentMethod(id));
              }}
            >
              Remove card
            </Button>
          </div>
        </Modal>
      )}

      {dialog === 'cancelPlan' && (
        <Modal title="Cancel your plan?" onClose={() => setDialog(null)}>
          <p className="t-body-lg">
            Everything keeps working until the end of the period you have already paid for. Trips you
            have already booked are unaffected.
          </p>
          <div className="dialog-actions">
            <Button variant="text" onClick={() => setDialog(null)}>
              Keep my plan
            </Button>
            <Button
              onClick={() => {
                setDialog(null);
                void act(() => api.cancelSubscription());
              }}
            >
              Cancel plan
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function CurrentPlan({ subscription, busy, onCancel }: { subscription: Subscription; busy: boolean; onCancel: () => void }) {
  const renewalLabel =
    subscription.status === 'trialing'
      ? 'Trial ends'
      : subscription.status === 'pendingCancellation'
        ? 'Access ends'
        : 'Renews';

  return (
    <AppCard>
      <p className="t-title">{subscriptionSummary(subscription)}</p>
      <p className="t-body-lg mt-xs">
        {formatMoney(subscription.renewalTotalCents)} {intervalCadence[subscription.interval]}
      </p>
      <div className="mt-sm">
        <InfoRow label={renewalLabel} value={formatDay(subscription.trialEndsAt ?? subscription.currentPeriodEnd)} />
        {subscription.carriedCreditCents > 0 && (
          <InfoRow label="Credit carried forward" value={formatMoney(subscription.carriedCreditCents)} />
        )}
      </div>
      {subscriptionNeedsAttention(subscription) && (
        // Said plainly, and early: finding out when the map goes blank mid-trip
        // is the failure the grace window exists to prevent.
        <p className="t-body error-text mt-sm">
          {subscription.status === 'pastDue'
            ? 'A payment did not go through. Everything keeps working for now; update your card to avoid interruption.'
            : `Your plan ends on ${formatDay(subscription.currentPeriodEnd)}. Until then nothing changes.`}
        </p>
      )}
      <Divider />
      {subscription.entitlements.map((entitlement) => (
        <div key={entitlement} className="row tight" style={{ padding: '2px 0' }}>
          <CircleCheck size={18} className="ink-primary" aria-hidden />
          <p className="t-body grow">{entitlementLabel[entitlement]}</p>
        </div>
      ))}
      {subscription.status !== 'pendingCancellation' && (
        <Button variant="text" className="align-start mt-sm" disabled={busy} onClick={onCancel}>
          Cancel plan
        </Button>
      )}
    </AppCard>
  );
}

function SwitchInterval(props: {
  subscription: Subscription;
  plans: SubscriptionPlan[];
  busy: boolean;
  onSwitch: (interval: 'monthly' | 'annual') => void;
}) {
  const other = props.subscription.interval === 'monthly' ? 'annual' : 'monthly';
  const target = props.plans.find((p) => p.code === props.subscription.planCode && p.interval === other);
  if (!target) return null;

  return (
    <AppCard className="mt-md">
      <p className="t-title-sm">Billed {intervalLabel[other].toLowerCase()}</p>
      <p className="t-body muted mt-xs">
        The unused part of the period you have paid for is credited, and a new one starts today.
      </p>
      <Button variant="outlined" className="mt-sm" disabled={props.busy} onClick={() => props.onSwitch(other)}>
        Switch to {formatMoney(periodPriceCents(target))} {intervalCadence[other]}
      </Button>
    </AppCard>
  );
}

/**
 * The card renewals are charged against — shown whether or not one exists,
 * because the absence is the state worth mentioning before it causes a decline.
 */
function PaymentMethodCard(props: {
  card: PaymentMethod | null;
  amountDueCents: number;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { card } = props;
  const now = new Date();
  return (
    <AppCard>
      <p className="t-title">Payment method</p>
      {card === null ? (
        <p className="t-body mt-xs">No card on file. Add one so your plan renews without interruption.</p>
      ) : (
        <>
          <div className="row tight mt-xs">
            <CreditCard size={20} aria-hidden />
            <p className="t-body-lg grow">{paymentMethodLabel(card)}</p>
          </div>
          {(cardHasExpired(card, now) || cardExpiresSoon(card, now)) && (
            <p className="t-small error-text mt-xs">
              {cardHasExpired(card, now) ? 'This card has expired.' : 'This card expires soon.'}
            </p>
          )}
        </>
      )}
      {props.amountDueCents > 0 && (
        <p className="t-body mt-xs">Outstanding: {formatMoney(props.amountDueCents)}</p>
      )}
      <div className="wrap mt-md">
        <Button icon={WalletCards} disabled={props.busy} onClick={props.onAdd}>
          {card === null ? 'Add a card' : 'Replace this card'}
        </Button>
        {card !== null && (
          <Button variant="text" disabled={props.busy} onClick={props.onRemove}>
            Remove
          </Button>
        )}
      </div>
    </AppCard>
  );
}

/**
 * One invoice, itemised as it was charged — the server reads the lines back
 * off the invoice rather than recomputing them from today's prices.
 */
function InvoiceCard({ invoice, busy, onPay }: { invoice: Invoice; busy: boolean; onPay: () => void }) {
  return (
    <AppCard>
      <div className="row">
        <p className="t-title-sm grow">{invoice.number}</p>
        <p className="t-title-sm">{formatMoney(invoice.totalCents)}</p>
      </div>
      <div className="mt-xs">
        <InfoRow label={invoiceReasonLabel[invoice.reason]} value={invoiceStatusLabel[invoice.status]} />
        <InfoRow label="Issued" value={formatDay(invoice.issuedAt)} />
        {invoice.creditAppliedCents > 0 && (
          <InfoRow label="Credit applied" value={formatMoney(invoice.creditAppliedCents)} />
        )}
      </div>
      {invoice.lines.map((line, i) => (
        <div key={i} className="line small">
          <span>{line.label}</span>
          <span>{formatMoney(line.amountCents)}</span>
        </div>
      ))}
      {invoiceIsOutstanding(invoice) && (
        <div className="mt-sm">
          <p className="t-body error-text">{DunningCopy.headline(invoice)}</p>
          <p className="t-small">{DunningCopy.detail(invoice)}</p>
          {invoiceCanBePaidNow(invoice) && (
            <Button variant="text" className="align-start" disabled={busy} onClick={onPay}>
              Try this payment again
            </Button>
          )}
        </div>
      )}
    </AppCard>
  );
}

function PlanCard(props: {
  plan: SubscriptionPlan;
  subscription: Subscription | null;
  busy: boolean;
  onChoose: () => void;
}) {
  const { plan, subscription } = props;
  const isCurrent =
    subscription !== null && subscription.planCode === plan.code && subscription.interval === plan.interval;
  return (
    <AppCard>
      <div className="row">
        <p className="t-title grow">{plan.name}</p>
        {isCurrent && <span className="t-label ink-primary">Current</span>}
      </div>
      <p className="t-body-lg mt-xs">
        {formatMoney(plan.basePriceCents)} {intervalCadence[plan.interval]}
      </p>
      <p className="t-body muted mt-xs">{plan.description}</p>
      {plan.trialDays > 0 && subscription === null && (
        <p className="t-body mt-xs">{plan.trialDays} days free first.</p>
      )}
      {subscription === null && (
        <Button className="mt-sm" disabled={props.busy} onClick={props.onChoose}>
          Choose this plan
        </Button>
      )}
    </AppCard>
  );
}

/**
 * Where a card goes on file without a card number reaching this app. ADR-0006
 * puts that boundary at the client: the processor's own form takes the number
 * and hands back a token, and this dialog holds that place until the SDK is
 * wired to a real account. `POST /billing/payment-method` does not change when
 * it is. Collecting a card number here "only in development" is how it would
 * reach production.
 */
function PaymentTokenDialog({ onClose }: { onClose: (token: string | null) => void }) {
  const [token, setToken] = useState('');
  const trimmed = token.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmed !== '') onClose(trimmed);
  }

  return (
    <Modal title="Add a card" onClose={() => onClose(null)}>
      <form onSubmit={submit} noValidate>
        <p className="t-body">
          CareBridge never sees your card number. Your bank’s payment provider takes the card and gives
          us a reference to it, and that reference is what goes in the box below.
        </p>
        <div className="mt-sm">
          <TextField
            label="Card reference"
            placeholder="tok_…"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <p className="t-small muted mt-sm">
          Running against the local payments adapter, any text works and its last four digits decide the
          outcome: 4242 succeeds, 9995 is declined.
        </p>
        <div className="dialog-actions">
          <Button variant="text" onClick={() => onClose(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={trimmed === ''}>
            Save card
          </Button>
        </div>
      </form>
    </Modal>
  );
}
