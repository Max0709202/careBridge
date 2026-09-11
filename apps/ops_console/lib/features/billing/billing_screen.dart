import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../core/money.dart';
import '../../domain/billing.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// What this operator pays for the console, the driver app and assignment.
///
/// The **second** payer (ADR-0011). The Seats screen beside this one answers
/// "why were we billed for eleven drivers"; this one answers "billed for what,
/// on what cadence, against which card, and what happens if it bounces" —
/// which until now had no surface at all, with the consequence that an
/// operator could be sent an invoice they could neither see nor pay.
///
/// Nothing about a price is compiled in. The catalogue is rows on the server,
/// so a new tier or a price change is an insert rather than a release, and a
/// console that hard-coded "$249 a month" would be quoting a number the
/// invoice then contradicts.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organizationId = ref.watch(selectedOrganizationIdProvider);
    if (organizationId == null) return const LoadingBlock();

    final account = ref.watch(billingProvider(organizationId));

    return RefreshIndicator(
      onRefresh: () async => refreshBillingState(ref, organizationId),
      child: account.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => ListView(
          children: [
            EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load billing',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () =>
                    ref.invalidate(billingProvider(organizationId)),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
        data: (data) => _Body(organizationId: organizationId, account: data),
      ),
    );
  }
}

class _Body extends ConsumerStatefulWidget {
  const _Body({required this.organizationId, required this.account});

  final String organizationId;
  final BillingAccount account;

  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  bool _busy = false;

  /// Runs one billing action and refreshes everything it can have changed.
  ///
  /// Refreshing all three — account, invoices, seats — rather than the one the
  /// action names: subscribing writes an invoice, changing interval credits
  /// the old period and issues a new one, and paying an invoice changes what
  /// is owed. A screen that refreshed only the obvious one shows two figures
  /// that disagree.
  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) refreshBillingState(ref, widget.organizationId);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final account = widget.account;
    final subscription = account.subscription;

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        if (subscription == null)
          _noPlan(theme)
        else
          _plan(theme, subscription),

        const SectionHeader('Card on file'),
        _card(theme, account),

        if (subscription == null) ...[
          const SectionHeader('Plans'),
          _catalogue(theme),
        ],

        const SectionHeader('Invoices'),
        _invoices(theme),
      ],
    );
  }

  // ─── the plan ───────────────────────────────────────────────────────────

  Widget _noPlan(ThemeData theme) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('No plan', style: theme.textTheme.titleMedium),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'This operator is not on a subscription. Without one the platform '
          'takes a margin on each fare instead — an operator paying by seats '
          'keeps the whole fare, and charging both would be charging twice for '
          'one relationship.',
          style: theme.textTheme.bodyMedium,
        ),
      ],
    ),
  );

  Widget _plan(ThemeData theme, OperatorSubscription subscription) {
    final quote = subscription.renewalQuote;

    return OpsCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  subscription.planName,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              _StatusPill(subscription.status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          _row(
            theme,
            'Billing period',
            '${subscription.interval.label} · renews '
                '${DateFormat('d MMM y').format(subscription.currentPeriodEnd.toLocal())}',
          ),
          _row(theme, 'Drivers billed', '${subscription.seats}'),
          _row(theme, 'Next renewal', formatCents(quote.totalCents)),
          if (subscription.carriedCreditCents > 0)
            _row(
              theme,
              'Credit carried',
              formatCents(subscription.carriedCreditCents),
            ),

          // The renewal, itemised. An operator asking "why is it $412?" is
          // answered by the lines rather than by a support conversation.
          const SizedBox(height: AppSpacing.sm),
          for (final line in quote.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 1),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      line.quantity > 1
                          ? '${line.label} × ${line.quantity}'
                          : line.label,
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                  Text(
                    formatCents(line.amountCents),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),

          if (subscription.isTrialing && subscription.trialEndsAt != null)
            _note(
              theme,
              'The free trial ends on '
              '${DateFormat('d MMM y').format(subscription.trialEndsAt!.toLocal())}. '
              'The card on file is charged then.',
            ),
          if (subscription.status == SubscriptionStatus.pastDue)
            _note(
              theme,
              'A payment failed. The console keeps working for the plan’s '
              'grace window — the point of that window is that somebody finds '
              'out by being told rather than by a shift that stops.',
              emphasis: true,
            ),
          if (subscription.isCancelling)
            _note(
              theme,
              'Cancelled. Everything keeps working until '
              '${DateFormat('d MMM y').format(subscription.currentPeriodEnd.toLocal())}, '
              'because that period is paid for.',
            ),

          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              if (!subscription.isCancelling) ...[
                OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _changeInterval(subscription.interval),
                  child: Text(
                    subscription.interval == BillingInterval.monthly
                        ? 'Switch to yearly'
                        : 'Switch to monthly',
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : _confirmCancel,
                  child: const Text('Cancel plan'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _changeInterval(BillingInterval current) async {
    final next = current == BillingInterval.monthly
        ? BillingInterval.annual
        : BillingInterval.monthly;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Switch to ${next.label.toLowerCase()} billing'),
        // Said before it happens, because the money moves immediately: the
        // unused remainder of this period is credited and a fresh period
        // starts today. Annual → monthly leaves a credit against renewals
        // rather than producing a refund, and discovering that afterwards is
        // how a switch becomes a complaint.
        content: const Text(
          'The unused remainder of the current period is credited and a fresh '
          'period starts today. If the credit is larger than the new period, '
          'the difference is carried against future renewals rather than '
          'refunded.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep as it is'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Switch'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await _run(
        () => ref
            .read(opsApiProvider)
            .changeInterval(
              organizationId: widget.organizationId,
              interval: next,
            ),
      );
    }
  }

  Future<void> _confirmCancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this subscription'),
        content: const Text(
          'Not a refund and not an immediate switch-off: the console, the '
          'driver app and assignment keep working until the end of the period '
          'that has been paid for. After that this operator falls back to a '
          'per-fare margin.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep the plan'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cancel at period end'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await _run(
        () =>
            ref.read(opsApiProvider).cancelSubscription(widget.organizationId),
      );
    }
  }

  // ─── the card ───────────────────────────────────────────────────────────

  /// Shown whether or not one exists, because the **absence** is the more
  /// important state: a subscription with no card is one renewal away from
  /// dunning, and the moment to say so is before it happens rather than after.
  Widget _card(ThemeData theme, BillingAccount account) {
    final card = account.paymentMethod;
    final now = DateTime.now();

    return OpsCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (card == null)
            Text('No card on file.', style: theme.textTheme.bodyLarge)
          else ...[
            Row(
              children: [
                const Icon(Icons.credit_card_outlined, size: 20),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(card.label, style: theme.textTheme.bodyLarge),
                ),
                Text(
                  'Expires ${card.expMonth.toString().padLeft(2, '0')}/${card.expYear}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            if (card.hasExpired(now))
              _note(theme, 'This card has expired.', emphasis: true),
          ],
          if (account.willBillWithoutACard)
            _note(
              theme,
              'This subscription will bill a card that is not there. Add one '
              'before the period ends.',
              emphasis: true,
            ),
          if (account.amountDueCents > 0)
            _note(
              theme,
              'Outstanding: ${formatCents(account.amountDueCents)}',
              emphasis: true,
            ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            children: [
              FilledButton.icon(
                onPressed: _busy ? null : _addCard,
                icon: const Icon(Icons.add_card_outlined),
                label: Text(card == null ? 'Add a card' : 'Replace the card'),
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

  Future<void> _addCard() async {
    final token = await showDialog<String>(
      context: context,
      builder: (context) => const PaymentTokenDialog(),
    );
    if (token == null || token.isEmpty) return;

    await _run(
      () => ref
          .read(opsApiProvider)
          .attachPaymentMethod(
            organizationId: widget.organizationId,
            token: token,
          ),
    );
  }

  Future<void> _removeCard(PaymentMethod card) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this card'),
        content: Text(
          'Renewals will have nothing to charge until another card is added. '
          '${card.label} stays named on the payments it already made.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed ?? false) {
      await _run(
        () => ref
            .read(opsApiProvider)
            .detachPaymentMethod(
              organizationId: widget.organizationId,
              paymentMethodId: card.id,
            ),
      );
    }
  }

  // ─── the catalogue ──────────────────────────────────────────────────────

  Widget _catalogue(ThemeData theme) {
    final plans = ref.watch(operatorPlansProvider);

    return plans.when(
      loading: () => const LoadingBlock(),
      error: (error, _) => EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load the plans',
        message: 'Check your connection and try again.',
        action: OutlinedButton(
          onPressed: () => ref.invalidate(operatorPlansProvider),
          child: const Text('Retry'),
        ),
      ),
      data: (list) => Column(
        children: [
          if (list.isEmpty)
            const EmptyState(
              icon: Icons.inventory_2_outlined,
              title: 'No plans published',
              message:
                  'The operator catalogue is empty. Nothing can be subscribed '
                  'to until a plan row exists.',
            )
          else
            for (final plan in list) ...[
              _planCard(theme, plan),
              const SizedBox(height: AppSpacing.sm),
            ],
        ],
      ),
    );
  }

  Widget _planCard(ThemeData theme, OperatorPlan plan) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(plan.name, style: theme.textTheme.titleMedium),
            ),
            Text(
              '${formatCents(plan.basePriceCents)} ${plan.interval.cadence}',
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(plan.description, style: theme.textTheme.bodyMedium),
        const SizedBox(height: AppSpacing.sm),
        Text(
          plan.includedSeats > 0
              ? 'Covers ${plan.includedSeats} driver(s); above that the '
                    'graduated ladder applies.'
              : 'Every driver is priced on the graduated ladder.',
          style: theme.textTheme.bodySmall,
        ),
        for (final tier in plan.seatTiers)
          Text(
            tier.upToSeats == null
                ? 'Beyond that: ${formatCents(tier.unitPriceCents)} per driver'
                : 'Up to ${tier.upToSeats} drivers: '
                      '${formatCents(tier.unitPriceCents)} each',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          // Both numbers belong on the card rather than in a policy page: they
          // are the answers to "can we try it" and "what happens if the card
          // bounces", and both questions are asked here, at the moment of
          // subscribing.
          '${plan.trialDays > 0 ? '${plan.trialDays}-day free trial. ' : ''}'
          'A failed payment keeps working for ${plan.graceDays} day(s).',
          style: theme.textTheme.bodySmall,
        ),
        if (plan.entitlements.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs),
            child: Text(
              'Includes: ${plan.entitlements.join(', ')}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        const SizedBox(height: AppSpacing.md),
        FilledButton(
          onPressed: _busy ? null : () => _subscribe(plan),
          child: Text('Subscribe ${plan.interval.label.toLowerCase()}'),
        ),
      ],
    ),
  );

  Future<void> _subscribe(OperatorPlan plan) => _run(
    () => ref
        .read(opsApiProvider)
        .subscribe(
          organizationId: widget.organizationId,
          planCode: plan.code,
          interval: plan.interval,
        ),
  );

  // ─── invoices ───────────────────────────────────────────────────────────

  Widget _invoices(ThemeData theme) {
    final invoices = ref.watch(invoicesProvider(widget.organizationId));

    return invoices.when(
      loading: () => const LoadingBlock(),
      error: (error, _) => EmptyState(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load invoices',
        message: 'Check your connection and try again.',
        action: OutlinedButton(
          onPressed: () =>
              ref.invalidate(invoicesProvider(widget.organizationId)),
          child: const Text('Retry'),
        ),
      ),
      data: (list) => Column(
        children: [
          if (list.isEmpty)
            const EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'Nothing billed yet',
              message: 'Invoices appear here as periods renew.',
            )
          else
            for (final invoice in list) ...[
              _invoiceCard(theme, invoice),
              const SizedBox(height: AppSpacing.sm),
            ],
        ],
      ),
    );
  }

  Widget _invoiceCard(ThemeData theme, Invoice invoice) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${invoice.number} · ${invoice.reason.label}',
                style: theme.textTheme.bodyLarge,
              ),
            ),
            Text(
              formatCents(invoice.totalCents),
              style: theme.textTheme.bodyLarge,
            ),
          ],
        ),
        Text(
          '${invoice.status.label} · issued '
          '${DateFormat('d MMM y').format(invoice.issuedAt.toLocal())}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),

        // Read back off the invoice by the server rather than recomputed from
        // today's catalogue, so a bill from eight months ago still shows the
        // prices it actually charged.
        const SizedBox(height: AppSpacing.xs),
        for (final line in invoice.lines)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 1),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    line.quantity > 1
                        ? '${line.label} × ${line.quantity}'
                        : line.label,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
                Text(
                  formatCents(line.amountCents),
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
        if (invoice.creditAppliedCents > 0)
          Row(
            children: [
              Expanded(
                child: Text('Credit applied', style: theme.textTheme.bodySmall),
              ),
              Text(
                '-${formatCents(invoice.creditAppliedCents)}',
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),

        if (invoice.hasFailed)
          _note(
            theme,
            invoice.nextAttemptAt == null
                ? 'Payment failed ${invoice.attemptCount} time(s). No further '
                      'attempt is scheduled.'
                : 'Payment failed ${invoice.attemptCount} time(s). Next '
                      'attempt '
                      '${DateFormat('d MMM y, HH:mm').format(invoice.nextAttemptAt!.toLocal())}.',
            emphasis: true,
          ),

        if (invoice.isPayable) ...[
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(
            // For the moment after a declined card is replaced: waiting a day
            // for the scheduled retry, while the screen still says the payment
            // failed, reads as the update not having worked.
            onPressed: _busy ? null : () => _pay(invoice),
            child: const Text('Pay now'),
          ),
        ],
      ],
    ),
  );

  Future<void> _pay(Invoice invoice) => _run(
    () => ref
        .read(opsApiProvider)
        .payInvoice(
          organizationId: widget.organizationId,
          invoiceId: invoice.id,
        ),
  );

  // ─── shared bits ────────────────────────────────────────────────────────

  Widget _row(ThemeData theme, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
        Text(value, style: theme.textTheme.bodyMedium),
      ],
    ),
  );

  Widget _note(ThemeData theme, String text, {bool emphasis = false}) =>
      Padding(
        padding: const EdgeInsets.only(top: AppSpacing.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              emphasis ? Icons.error_outline : Icons.info_outline,
              size: 16,
              color: emphasis ? OpsColors.overdue : theme.colorScheme.outline,
            ),
            const SizedBox(width: AppSpacing.xs),
            Expanded(child: Text(text, style: theme.textTheme.bodySmall)),
          ],
        ),
      );
}

/// The subscription's standing, as an icon and a word rather than a colour.
class _StatusPill extends StatelessWidget {
  const _StatusPill(this.status);

  final SubscriptionStatus status;

  @override
  Widget build(BuildContext context) {
    final (foreground, background, icon) = switch (status) {
      SubscriptionStatus.active => (
        OpsColors.positive,
        OpsColors.positiveContainer,
        Icons.check_circle_outline,
      ),
      SubscriptionStatus.trialing => (
        OpsColors.soon,
        OpsColors.soonContainer,
        Icons.schedule,
      ),
      SubscriptionStatus.pastDue => (
        OpsColors.overdue,
        OpsColors.overdueContainer,
        Icons.error_outline,
      ),
      SubscriptionStatus.pendingCancellation => (
        OpsColors.imminent,
        OpsColors.imminentContainer,
        Icons.event_busy_outlined,
      ),
      SubscriptionStatus.canceled || SubscriptionStatus.expired => (
        OpsColors.later,
        OpsColors.laterContainer,
        Icons.do_not_disturb_on_outlined,
      ),
    };

    return Semantics(
      label: 'Subscription: ${status.label}',
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: AppRadius.controlAll,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: foreground),
            const SizedBox(width: AppSpacing.xs),
            Text(
              status.label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Where a card is put on file, without a card number reaching this process.
///
/// ADR-0006 puts that boundary at the client: the intended surface is Stripe's
/// PaymentSheet, which hands back a token and never lets the app see the
/// number. That SDK is not wired up yet — it needs a Stripe account and
/// platform configuration neither of which exists here — so this dialog takes
/// **the token itself**, which is exactly what the API accepts and exactly
/// what PaymentSheet will supply when it lands. Replacing this widget is then
/// the whole change; no endpoint moves.
///
/// The alternative — asking for a card number here and tokenising it
/// ourselves — would put a PAN through this process and its logs, which is the
/// one thing ADR-0006 exists to prevent, and doing it "only in development" is
/// how it ends up in production.
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
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'CareBridge never sees a card number. The payment processor '
              'takes the card and hands back a token; that token is what this '
              'field wants and what the API stores.',
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
                labelText: 'Processor token',
                hintText: 'tok_…',
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              // The local adapter's whole purpose is that the unhappy path is
              // reachable without an account, and it is unreachable if nobody
              // is told which digits produce it.
              'Against the local payments adapter any string works, and its '
              'last four digits choose the outcome — Stripe’s own test-card '
              'meanings: 4242 settles, 9995 is declined for insufficient '
              'funds, 9979 is reported stolen.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
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
          child: const Text('Save the card'),
        ),
      ],
    );
  }
}
