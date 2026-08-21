import 'package:flutter/material.dart';

import '../app/theme.dart';

/// A labelled block of information, sized to be read at a glance.
class InfoCard extends StatelessWidget {
  const InfoCard({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: padding ?? const EdgeInsets.all(DriverSpacing.md),
      child: child,
    ),
  );
}

/// A requirement the driver has to have understood before setting off.
///
/// Icon **and** word, never colour alone — the same WCAG 1.4.1 rule the family
/// app's status pills follow. It matters as much here: "wheelchair" and
/// "assistance" are the two facts that decide whether this trip can happen at
/// all, and red-green is the encoding 8% of men cannot read.
class RequirementChip extends StatelessWidget {
  const RequirementChip({super.key, required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DriverSpacing.md,
        vertical: DriverSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: DriverRadius.controlAll,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 20, color: scheme.onTertiaryContainer),
          const SizedBox(width: DriverSpacing.sm),
          Text(
            label,
            style: TextStyle(
              color: scheme.onTertiaryContainer,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Nothing to do, said in words.
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DriverSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: theme.colorScheme.outline),
            const SizedBox(height: DriverSpacing.md),
            Text(title, style: theme.textTheme.titleLarge),
            const SizedBox(height: DriverSpacing.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: DriverSpacing.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// A failure, with a way out of it.
///
/// Never a stack trace and never a URL: [Failure] messages are written for the
/// person holding the phone, and this widget must not add to them.
class FailureBlock extends StatelessWidget {
  const FailureBlock({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
    icon: Icons.cloud_off_outlined,
    title: 'Something went wrong',
    message: message,
    action: onRetry == null
        ? null
        : OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Try again'),
          ),
  );
}
