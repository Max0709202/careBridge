import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// What this operator is billed, and the ledger behind it.
///
/// The screen exists because of one question: "why were we billed for eleven
/// drivers?" Answered from the `drivers` table alone it is unanswerable — that
/// table has changed by the time anybody asks. The seat ledger is the append-
/// only record of when each seat was granted or released and what it cost at
/// the time, and putting it in front of the operator is what makes the invoice
/// checkable. A bill nobody can check is a bill somebody eventually disputes.
class SeatsScreen extends ConsumerWidget {
  const SeatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organizationId = ref.watch(selectedOrganizationIdProvider);
    if (organizationId == null) return const LoadingBlock();

    final seats = ref.watch(seatsProvider(organizationId));

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(seatsProvider(organizationId)),
      child: seats.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => ListView(
          children: [
            EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load seats',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () => ref.invalidate(seatsProvider(organizationId)),
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
        data: (summary) => _body(context, summary),
      ),
    );
  }

  Widget _body(BuildContext context, SeatSummary summary) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        OpsCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Seats', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              _row(theme, 'Drivers on the road', '${summary.activeDrivers}'),
              _row(theme, 'Billed at last renewal', '${summary.billedSeats}'),
              if (summary.renewalTotalCents != null)
                _row(theme, 'Next renewal', _money(summary.renewalTotalCents!)),
              // The two numbers differ whenever a driver was approved
              // mid-period, and the difference is not a discrepancy — the seat
              // was charged immediately by proration and folds into the
              // recurring amount at renewal. Explained on the screen that
              // shows both, rather than queried later.
              if (summary.pendingAtRenewal != 0)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.sm),
                  child: Text(
                    summary.pendingAtRenewal > 0
                        ? '${summary.pendingAtRenewal} seat(s) added since the last '
                              'renewal — charged pro rata now, and folded into the '
                              'recurring amount at renewal.'
                        : '${-summary.pendingAtRenewal} seat(s) released — they stay '
                              'usable until the period that paid for them ends, and '
                              'are not refunded.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SectionHeader('Seat ledger'),
        if (summary.ledger.isEmpty)
          const EmptyState(
            icon: Icons.receipt_long_outlined,
            title: 'No seat changes yet',
            message: 'Approving or offboarding a driver records an entry here.',
          )
        else
          for (final entry in summary.ledger) ...[
            _ledgerRow(theme, entry),
            const SizedBox(height: AppSpacing.sm),
          ],
      ],
    );
  }

  Widget _row(ThemeData theme, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
        Text(value, style: theme.textTheme.bodyMedium),
      ],
    ),
  );

  Widget _ledgerRow(ThemeData theme, SeatLedgerEntry entry) => OpsCard(
    child: Row(
      children: [
        Icon(
          entry.isGrant
              ? Icons.person_add_outlined
              : Icons.person_remove_outlined,
          size: 18,
          color: entry.isGrant ? OpsColors.positive : theme.colorScheme.outline,
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(entry.driverDisplayName, style: theme.textTheme.bodyMedium),
              Text(
                '${DateFormat('d MMM y').format(entry.at.toLocal())} · '
                '${entry.seatsAfter} seat(s) after',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        Text(
          // Zero on a release, and that is the rule rather than a gap: a
          // released seat is not refunded, because it stays usable until the
          // period that paid for it ends.
          entry.prorationCents > 0 ? _money(entry.prorationCents) : '—',
          style: theme.textTheme.bodyMedium,
        ),
      ],
    ),
  );

  static String _money(int cents) {
    final negative = cents < 0;
    final abs = cents.abs();
    final remainder = (abs % 100).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}\$${abs ~/ 100}.$remainder';
  }
}
