import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../core/money.dart';
import '../../data/billing_codec.dart';
import '../../data/care_api.dart';
import '../../domain/billing.dart';
import '../../domain/invoicing.dart';
import '../../domain/subscription_pricing.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// What this household pays, and what it buys.
///
/// The whole catalogue comes from the server. Nothing about a price, an
/// interval or an entitlement is compiled into this screen — a plan change is
/// a database insert, and a client that hard-coded "$29 a month" would be
/// quoting a number the invoice then contradicts.
///
/// The screen deliberately says what the *other* payer covers as well. A family
/// looking at a transport bill is entitled to know that the platform's cut of
/// their fare is zero when the operator is on a plan, because otherwise "why is
/// there a subscription *and* a fare" has no honest answer.
class PlanScreen extends ConsumerStatefulWidget {
  const PlanScreen({super.key});

  @override
  ConsumerState<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends ConsumerState<PlanScreen> {
  Subscription? _subscription;
  List<SubscriptionPlan> _plans = const [];
  List<Invoice> _invoices = const [];
  PaymentMethod? _card;
  int _amountDueCents = 0;
  Object? _error;
  bool _loaded = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final api = ref.read(careApiProvider);
      final account = await api.billingAccount();
      final plans = await api.billingPlans();
      // Only fetched once we know there is an account. Asking for the invoices
      // of a household that has none is a request whose only possible answer
      // is an empty list.
      final invoices = account == null ? <Invoice>[] : await _invoicesFor(api);

      if (!mounted) return;
      setState(() {
        _subscription = subscriptionFromWire(account?.subscription);
        _plans = [for (final plan in plans) ?planFromWire(plan)];
        _invoices = invoices;
        _card = paymentMethodFromWire(account?.paymentMethod);
        _amountDueCents = account?.amountDueCents ?? 0;
        _loaded = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<List<Invoice>> _invoicesFor(CareApi api) async {
    final dtos = await api.invoices();
    return [for (final dto in dtos) ?invoiceFromWire(dto)];
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Your plan')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [ScreenBody(child: _body(theme))]),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_error != null) {
      return AppCard(
        child: EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load your plan',
          message: 'Check your connection and try again.',
          action: OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ),
      );
    }

    if (!_loaded) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final subscription = _subscription;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (subscription == null)
          _noPlan(theme)
        else ...[
          _current(theme, subscription),
          const SizedBox(height: AppSpacing.md),
          _switchInterval(theme, subscription),
        ],
        if (subscription != null) ...[
          const SizedBox(height: AppSpacing.lg),
          _paymentMethod(theme),
        ],
        if (_invoices.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          const SectionHeader('Invoices'),
          for (final invoice in _invoices) ...[
            _invoiceCard(theme, invoice),
            const SizedBox(height: AppSpacing.sm),
          ],
        ],
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader('Plans'),
        for (final plan in _plans) ...[
          _planCard(theme, plan, subscription),
          const SizedBox(height: AppSpacing.sm),
        ],
        const SizedBox(height: AppSpacing.md),
        _whoPays(theme),
      ],
    );
  }

  /// The card renewals are charged against.
  ///
  /// Shown whether or not one exists, because the absence is the more
  /// important state: an account with no card on file is one renewal away from
  /// dunning, and the only moment to mention that is before it happens.
  Widget _paymentMethod(ThemeData theme) {
    final card = _card;
    final now = DateTime.now();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Payment method', style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.xs),
          if (card == null)
            Text(
              'No card on file. Add one so your plan renews without '
              'interruption.',
              style: theme.textTheme.bodyMedium,
            )
          else ...[
            Row(
              children: [
                const Icon(Icons.credit_card_outlined, size: 20),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(card.label, style: theme.textTheme.bodyLarge),
                ),
              ],
            ),
            // Warned before it fails rather than after. A card that lapses
            // between renewals produces a decline nobody could have predicted
            // from this screen, which is the avoidable half of dunning.
            if (card.hasExpired(now) || card.expiresSoon(now))
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.xs),
                child: Text(
                  card.hasExpired(now)
                      ? 'This card has expired.'
                      : 'This card expires soon.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
          ],
          if (_amountDueCents > 0)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                'Outstanding: ${Money(_amountDueCents).format()}',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              FilledButton.icon(
                onPressed: _busy ? null : _addCard,
                icon: const Icon(Icons.add_card_outlined),
                label: Text(card == null ? 'Add a card' : 'Replace this card'),
              ),
              if (card != null)
                TextButton(
                  onPressed: _busy ? null : () => _removeCard(card),
                  child: const Text('Remove'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// Puts a card on file.
  ///
  /// The card number never reaches this app. ADR-0006 puts that boundary at
  /// the client — the processor's own sheet takes the number and hands back a
  /// token — and [PaymentTokenDialog] is where that sheet will be, holding the
  /// place until the SDK is wired to a real account. The API call below does
  /// not change when it is.
  Future<void> _addCard() async {
    final token = await showDialog<String>(
      context: context,
      builder: (context) => const PaymentTokenDialog(),
    );
    if (token == null || token.isEmpty) return;

    await _run(
      () async => ref.read(careApiProvider).attachPaymentMethod(token),
    );
  }

  Future<void> _removeCard(PaymentMethod card) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this card?'),
        // Both halves said plainly. The first is what somebody needs to hear
        // before they do it; the second is what they would otherwise wonder
        // about afterwards — a payment that has already happened still names
        // the card that made it.
        content: Text(
          'Your plan will have nothing to charge when it next renews, and it '
          'will lapse unless you add another card first.\n\n'
          '${card.label} stays on the payments it already made.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove card'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await _run(
        () async => ref.read(careApiProvider).detachPaymentMethod(card.id),
      );
    }
  }

  /// One invoice, itemised.
  ///
  /// The line items come from the server, which read them back off the invoice
  /// rather than recomputing them from today's catalogue — so a bill from
  /// eight months ago still shows the prices it actually charged.
  Widget _invoiceCard(ThemeData theme, Invoice invoice) {
    final overdue = invoice.status.isOutstanding;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(invoice.number, style: theme.textTheme.titleSmall),
              ),
              Text(
                Money(invoice.totalCents).format(),
                style: theme.textTheme.titleSmall,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          InfoRow(label: invoice.reason.label, value: invoice.status.label),
          InfoRow(label: 'Issued', value: formatDay(invoice.issuedAt)),
          if (invoice.creditAppliedCents > 0)
            InfoRow(
              label: 'Credit applied',
              value: Money(invoice.creditAppliedCents).format(),
            ),
          const SizedBox(height: AppSpacing.xs),
          for (final line in invoice.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 1),
              child: Row(
                children: [
                  Expanded(
                    child: Text(line.label, style: theme.textTheme.bodySmall),
                  ),
                  Text(
                    Money(line.amountCents).format(),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          if (overdue) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              DunningCopy.headline(invoice),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
            Text(DunningCopy.detail(invoice), style: theme.textTheme.bodySmall),
            if (invoice.canBePaidNow)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _busy ? null : () => _pay(invoice),
                  child: const Text('Try this payment again'),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Future<void> _pay(Invoice invoice) =>
      _run(() => ref.read(careApiProvider).payInvoice(invoice.id));

  Widget _noPlan(ThemeData theme) => AppCard(
    child: EmptyState(
      icon: Icons.credit_card_outlined,
      title: 'No plan yet',
      message:
          'Choose a plan to book transportation and follow trips as they '
          'happen.',
      action: null,
    ),
  );

  Widget _current(ThemeData theme, Subscription subscription) {
    final renewal = Money(subscription.renewalTotalCents);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(subscription.summary, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${renewal.format()} ${subscription.interval.cadence}',
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: AppSpacing.sm),
          InfoRow(
            label: switch (subscription.status) {
              SubscriptionStatus.trialing => 'Trial ends',
              SubscriptionStatus.pendingCancellation => 'Access ends',
              _ => 'Renews',
            },
            value: formatDay(
              subscription.trialEndsAt ?? subscription.currentPeriodEnd,
            ),
          ),
          if (subscription.carriedCreditCents > 0)
            InfoRow(
              label: 'Credit carried forward',
              value: Money(subscription.carriedCreditCents).format(),
            ),
          if (subscription.needsAttention) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              switch (subscription.status) {
                // Said plainly, and early. The alternative — finding out when
                // the map goes blank mid-trip — is the failure the grace
                // window exists to prevent.
                SubscriptionStatus.pastDue =>
                  'A payment did not go through. Everything keeps working for '
                      'now; update your card to avoid interruption.',
                _ =>
                  'Your plan ends on '
                      '${formatDay(subscription.currentPeriodEnd)}. Until then '
                      'nothing changes.',
              },
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          const Divider(),
          for (final entitlement in subscription.entitlements)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      entitlement.label,
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
          if (subscription.status !=
              SubscriptionStatus.pendingCancellation) ...[
            const SizedBox(height: AppSpacing.sm),
            TextButton(
              onPressed: _busy ? null : _confirmCancel,
              child: const Text('Cancel plan'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _switchInterval(ThemeData theme, Subscription subscription) {
    final other = subscription.interval == BillingInterval.monthly
        ? BillingInterval.annual
        : BillingInterval.monthly;

    final target = _plans
        .where((p) => p.code == subscription.planCode && p.interval == other)
        .firstOrNull;
    if (target == null) return const SizedBox.shrink();

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Billed ${other.label.toLowerCase()}',
            style: theme.textTheme.titleSmall,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            // The credit is computed by the server; this line says what will
            // happen rather than a number the server might round differently.
            'The unused part of the period you have paid for is credited, and '
            'a new one starts today.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(
            onPressed: _busy
                ? null
                : () => _run(
                    () async => ref
                        .read(careApiProvider)
                        .changeBillingInterval(other.wire),
                  ),
            child: Text(
              'Switch to ${periodPrice(target).format()} ${other.cadence}',
            ),
          ),
        ],
      ),
    );
  }

  Widget _planCard(
    ThemeData theme,
    SubscriptionPlan plan,
    Subscription? subscription,
  ) {
    final isCurrent =
        subscription != null &&
        subscription.planCode == plan.code &&
        subscription.interval == plan.interval;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(plan.name, style: theme.textTheme.titleMedium),
              ),
              if (isCurrent)
                Text(
                  'Current',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${plan.basePrice.format()} ${plan.interval.cadence}',
            style: theme.textTheme.bodyLarge,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            plan.description,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (plan.trialDays > 0 && subscription == null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${plan.trialDays} days free first.',
              style: theme.textTheme.bodyMedium,
            ),
          ],
          if (subscription == null) ...[
            const SizedBox(height: AppSpacing.sm),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () => _run(
                      () async => ref
                          .read(careApiProvider)
                          .subscribe(
                            planCode: plan.code,
                            interval: plan.interval.wire,
                          ),
                    ),
              child: const Text('Choose this plan'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _whoPays(ThemeData theme) => AppCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('What the fare covers', style: theme.textTheme.titleSmall),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Your plan pays for the coordination — booking, tracking, reminders '
          'and the care circle. Each trip is charged separately, and that fare '
          'goes to the transport company that drives it. They pay us for the '
          'drivers they run, so we do not also take a cut of what you pay them.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    ),
  );

  Future<void> _confirmCancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel your plan?'),
        content: const Text(
          'Everything keeps working until the end of the period you have '
          'already paid for. Trips you have already booked are unaffected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep my plan'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cancel plan'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await _run(() async => ref.read(careApiProvider).cancelSubscription());
    }
  }
}

/// Where a card is put on file, without a card number reaching this app.
///
/// ADR-0006 is unambiguous about where that boundary sits: the payment
/// processor's own sheet takes the number, and CareBridge only ever sees a
/// token. That SDK needs a Stripe account and platform configuration that do
/// not exist yet, so this dialog stands in for the sheet and asks for **the
/// token itself** — which is exactly what `POST /billing/payment-method`
/// accepts and exactly what the sheet will hand over when it lands. Replacing
/// this widget is then the whole change; no endpoint moves.
///
/// The obvious alternative — collect a card number here and turn it into a
/// token ourselves — would put a card number through this app and its logs,
/// which is the one thing ADR-0006 exists to prevent. Doing it "only in
/// development" is how it reaches production.
class PaymentTokenDialog extends StatefulWidget {
  const PaymentTokenDialog({super.key});

  @override
  State<PaymentTokenDialog> createState() => _PaymentTokenDialogState();
}

class _PaymentTokenDialogState extends State<PaymentTokenDialog> {
  final _token = TextEditingController();

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: const Text('Add a card'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'CareBridge never sees your card number. Your bank\u2019s payment '
            'provider takes the card and gives us a reference to it, and that '
            'reference is what goes in the box below.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            controller: _token,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            onSubmitted: (value) => Navigator.of(
              context,
            ).pop(value.trim().isEmpty ? null : value.trim()),
            decoration: const InputDecoration(
              labelText: 'Card reference',
              hintText: 'tok_\u2026',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            // The local payments adapter exists so that a decline, and the
            // dunning that follows it, are reachable without a Stripe account
            // — and they are unreachable if nobody is told which digits
            // produce them. Stripe's own test-card meanings, so a developer
            // reproducing a ticket uses the number from the ticket.
            'Running against the local payments adapter, any text works and '
            'its last four digits decide the outcome: 4242 succeeds, 9995 is '
            'declined.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _token.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop(_token.text.trim()),
          child: const Text('Save card'),
        ),
      ],
    );
  }
}
