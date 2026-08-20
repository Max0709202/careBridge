import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../domain/dispatch.dart';

/// A band label that never relies on colour alone.
///
/// WCAG 1.4.1, and it matters more here than anywhere else in the product:
/// red-for-overdue against green-for-fine is the obvious encoding and the one
/// roughly 8% of men cannot read. Every pill carries an icon and a word, so
/// the colour is reinforcement rather than information.
class UrgencyPill extends StatelessWidget {
  const UrgencyPill(this.urgency, {super.key});

  final DispatchUrgency urgency;

  @override
  Widget build(BuildContext context) {
    final (foreground, background, icon) = switch (urgency) {
      DispatchUrgency.overdue => (
        OpsColors.overdue,
        OpsColors.overdueContainer,
        Icons.error_outline,
      ),
      DispatchUrgency.imminent => (
        OpsColors.imminent,
        OpsColors.imminentContainer,
        Icons.schedule,
      ),
      DispatchUrgency.soon => (
        OpsColors.soon,
        OpsColors.soonContainer,
        Icons.upcoming_outlined,
      ),
      DispatchUrgency.later => (
        OpsColors.later,
        OpsColors.laterContainer,
        Icons.event_outlined,
      ),
    };

    return Semantics(
      label: 'Urgency: ${urgency.label}',
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
              urgency.label,
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

/// A driver's standing, with the same icon-and-word rule.
class DriverStatusPill extends StatelessWidget {
  const DriverStatusPill(this.status, {super.key});

  final DriverStatus status;

  @override
  Widget build(BuildContext context) {
    final (foreground, background, icon) = switch (status) {
      DriverStatus.approved => (
        OpsColors.positive,
        OpsColors.positiveContainer,
        Icons.verified_outlined,
      ),
      DriverStatus.pendingApproval => (
        OpsColors.imminent,
        OpsColors.imminentContainer,
        Icons.pending_outlined,
      ),
      DriverStatus.suspended => (
        OpsColors.overdue,
        OpsColors.overdueContainer,
        Icons.pause_circle_outline,
      ),
      DriverStatus.invited => (
        OpsColors.soon,
        OpsColors.soonContainer,
        Icons.mail_outline,
      ),
      DriverStatus.offboarded => (
        OpsColors.later,
        OpsColors.laterContainer,
        Icons.person_off_outlined,
      ),
    };

    return Semantics(
      label: 'Driver status: ${status.label}',
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

class OpsCard extends StatelessWidget {
  const OpsCard({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: child,
      ),
    ),
  );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.lg, bottom: AppSpacing.sm),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        ?trailing,
      ],
    ),
  );
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(
        children: [
          Icon(icon, size: 40, color: theme.colorScheme.outline),
          const SizedBox(height: AppSpacing.sm),
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.xs),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (action != null) ...[
            const SizedBox(height: AppSpacing.md),
            action!,
          ],
        ],
      ),
    );
  }
}

/// Shows a failure without ever leaking a URL, a host or a stack frame.
///
/// [Failure.message] is the only thing rendered, and every one of them is
/// written to be safe in front of a person. Anything that is not a [Failure]
/// gets a fixed sentence rather than `error.toString()`, because that is where
/// an internal detail would otherwise reach a screen.
void showFailure(BuildContext context, Object error) {
  final message = error is Failure
      ? error.message
      : 'Something went wrong. Please try again.';

  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
  );
}

/// A loading state that occupies the space its content will, so a queue does
/// not jump under the pointer the instant it arrives.
class LoadingBlock extends StatelessWidget {
  const LoadingBlock({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(AppSpacing.xl),
    child: Center(child: CircularProgressIndicator()),
  );
}
