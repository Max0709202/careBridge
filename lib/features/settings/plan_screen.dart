import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../core/money.dart';
import '../../data/billing_codec.dart';
import '../../domain/billing.dart';
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

      if (!mounted) return;
      setState(() {
        _subscription = subscriptionFromWire(account?.subscription);
        _plans = [for (final plan in plans) ?planFromWire(plan)];
        _loaded = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
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
