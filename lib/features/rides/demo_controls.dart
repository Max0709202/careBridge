import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../domain/ride_status.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Stand-in controls for the driver app and the dispatch service.
///
/// Nothing here is a shortcut: "Run the trip" drives the ride through exactly
/// the same `advanceRide` state machine a real driver's transitions will, and
/// "Report a delay" sets the same flag a dispatcher would. When `apps/api` and
/// the driver app exist, this widget is deleted and nothing else changes.
///
/// It is visually marked as a preview tool so it can never be mistaken for a
/// family-facing feature.
class DemoControls extends ConsumerWidget {
  const DemoControls({required this.rideId, super.key});

  final String rideId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final notifier = ref.watch(careProvider.notifier);
    final ride = ref.watch(careProvider).rideById(rideId);
    if (ride == null || ride.status.isTerminal) return const SizedBox.shrink();

    final running = notifier.runningDemoRideId == rideId;

    return AppCard(
      borderColor: theme.colorScheme.outline,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.science_outlined, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Preview controls',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'The driver app and dispatch service do not exist yet. These stand '
            'in for them, and drive the same state machine the server will '
            'enforce.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              if (!running)
                FilledButton.tonalIcon(
                  onPressed: () => notifier.startDemoTrip(rideId),
                  icon: const Icon(Icons.play_arrow),
                  label: Text(
                    ride.status == RideStatus.awaitingAssignment ||
                            ride.status == RideStatus.requested
                        ? 'Assign a driver and run the trip'
                        : 'Continue the trip',
                  ),
                )
              else
                OutlinedButton.icon(
                  onPressed: notifier.stopDemoTrip,
                  icon: const Icon(Icons.pause),
                  label: const Text('Pause'),
                ),
              OutlinedButton.icon(
                onPressed: () {
                  try {
                    notifier.setDelay(
                      rideId,
                      delayed: !ride.isDelayed,
                      reason: ride.isDelayed ? null : 'Heavy traffic on Route 315',
                    );
                  } catch (error) {
                    showFailure(context, error);
                  }
                },
                icon: Icon(
                  ride.isDelayed
                      ? Icons.check_circle_outline
                      : Icons.watch_later_outlined,
                ),
                label: Text(
                  ride.isDelayed ? 'Clear the delay' : 'Report a delay',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
