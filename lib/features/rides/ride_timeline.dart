import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../domain/models.dart';
import '../../widgets/common.dart';

/// The ride's event history.
///
/// This is the artefact that settles disputes — "the driver never came", "we
/// were forty minutes late" — so it is shown to the family in full rather than
/// kept for operations. Exceptions (delays, no-shows, reassignments) are marked
/// with an icon and a colour, never colour alone.
class RideTimeline extends StatelessWidget {
  const RideTimeline({required this.events, super.key});

  final List<RideEvent> events;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (events.isEmpty) {
      return AppCard(
        child: Text(
          'Nothing has happened yet. Updates appear here as the trip proceeds.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }

    final ordered = [...events]..sort((a, b) => b.at.compareTo(a.at));

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < ordered.length; i++)
            _TimelineRow(
              event: ordered[i],
              isFirst: i == 0,
              isLast: i == ordered.length - 1,
            ),
        ],
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.event,
    required this.isFirst,
    required this.isLast,
  });

  final RideEvent event;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ink = event.isException
        ? context.criticalInk
        : (isFirst ? theme.colorScheme.primary : theme.colorScheme.outline);

    return Semantics(
      label:
          '${event.title}, ${formatTime(event.at)}'
          '${event.detail == null ? '' : '. ${event.detail}'}',
      excludeSemantics: true,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Icon(
                  event.isException
                      ? Icons.error_outline
                      : (isFirst
                            ? Icons.radio_button_checked
                            : Icons.circle_outlined),
                  size: 18,
                  color: ink,
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      color: theme.colorScheme.outlineVariant,
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      event.title,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight: isFirst ? FontWeight.w700 : FontWeight.w500,
                        color: event.isException ? context.criticalInk : null,
                      ),
                    ),
                    Text(
                      '${formatShortDay(event.at)} · ${formatTime(event.at)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (event.detail != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          event.detail!,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
