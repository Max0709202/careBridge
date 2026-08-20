import 'package:flutter/material.dart';

import '../app/theme.dart';
import 'package:carebridge_client/carebridge_client.dart';

/// A bordered content card. Flat rather than shadowed: elevation reads poorly at
/// high contrast settings and adds nothing here.
class AppCard extends StatelessWidget {
  const AppCard({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
    this.onTap,
    this.semanticLabel,
    this.borderColor,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final String? semanticLabel;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final card = Material(
      color: scheme.surface,
      borderRadius: AppRadius.cardAll,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.cardAll,
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: AppRadius.cardAll,
            border: Border.all(
              color: borderColor ?? scheme.outlineVariant,
              width: borderColor == null ? 1 : 1.5,
            ),
          ),
          child: child,
        ),
      ),
    );

    if (semanticLabel == null) return card;
    return Semantics(container: true, label: semanticLabel, child: card);
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {this.action, this.subtitle, super.key});

  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(title, style: theme.textTheme.titleMedium),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

/// Empty states explain what to do next rather than announcing that a list is
/// empty. "No appointments yet" is a dead end; an action is not.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 56, color: theme.colorScheme.primary),
              const SizedBox(height: AppSpacing.md),
              Text(
                title,
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              if (action != null) ...[
                const SizedBox(height: AppSpacing.lg),
                action!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Label/value row used throughout detail screens.
class InfoRow extends StatelessWidget {
  const InfoRow({
    required this.label,
    required this.value,
    this.icon,
    this.valueStyle,
    super.key,
  });

  final String label;
  final String value;
  final IconData? icon;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: '$label: $value',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: AppSpacing.sm + 4),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(value, style: valueStyle ?? theme.textTheme.bodyLarge),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Confirmation before anything destructive or outward-facing.
///
/// Cancelling a ride sends a car away from a person who is expecting it, so it
/// asks first — and the confirming button says what will happen rather than
/// "OK".
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  String cancelLabel = 'Keep it',
  bool destructive = true,
}) async {
  final scheme = Theme.of(context).colorScheme;
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message, style: Theme.of(context).textTheme.bodyLarge),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(cancelLabel),
        ),
        FilledButton(
          style: destructive
              ? FilledButton.styleFrom(
                  backgroundColor: scheme.error,
                  foregroundColor: scheme.onError,
                )
              : null,
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Shows a failure to the user.
///
/// Only [Failure.message] is ever surfaced — deliberately generic, and identical
/// for "not found" and "not permitted" so the message cannot be used to probe
/// whether a record exists.
/// The user-safe text for a failure.
///
/// Only [Failure.message] is ever surfaced — deliberately generic, and
/// identical for "not found" and "not permitted", so the message cannot be
/// used to probe whether a record exists. Anything that is not a [Failure] is
/// an unexpected exception, and its text belongs in a log rather than on
/// somebody's screen.
String failureMessage(Object error) => error is Failure
    ? error.message
    : 'Something went wrong. Please try again.';

void showFailure(BuildContext context, Object error) {
  final message = failureMessage(error);
  final scheme = Theme.of(context).colorScheme;

  ScaffoldMessenger.of(context)
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: AppSpacing.sm + 4),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: scheme.onErrorContainer, fontSize: 16),
              ),
            ),
          ],
        ),
        backgroundColor: scheme.errorContainer,
        duration: const Duration(seconds: 5),
      ),
    );
}

void showConfirmationBanner(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.check_circle_outline, color: Colors.white),
            const SizedBox(width: AppSpacing.sm + 4),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(color: Colors.white, fontSize: 16),
              ),
            ),
          ],
        ),
        backgroundColor: AppStatusColors.positive,
      ),
    );
}

/// Screen-level padding that keeps line length readable on a tablet or desktop
/// window instead of stretching text to 1200px.
class ScreenBody extends StatelessWidget {
  const ScreenBody({required this.child, this.maxWidth = 720, super.key});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.md,
            AppSpacing.xxl,
          ),
          child: child,
        ),
      ),
    );
  }
}
