import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../domain/ride_status.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Stand-in controls for the driver app and the dispatch service.
///
/// Nothing here is a shortcut. "Run the trip" asks the **server** to drive the
/// ride through exactly the same transition endpoint a real driver's app will
/// call, and "Report a delay" sets the same flag a dispatcher would. Neither
/// has a privileged path: an illegal transition is rejected here exactly as it
/// would be from a phone.
///
/// The trip runs server-side, so closing this tab does not stop it and a
/// refresh does not lose it — which is also how it will behave when a real
/// driver is holding the phone. When `apps/mobile_driver` exists, this widget
/// is deleted and nothing else changes.
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

    // Read from the server's snapshot rather than from a local flag, so the
    // button says the right thing after a refresh or on a second device.
    final running = notifier.isPreviewRunning(rideId);

    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } catch (error) {
        if (context.mounted) showFailure(context, error);
      }
    }

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
            'in for them, and drive the same state machine on the same server '
            'a real driver would.',
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
                  onPressed: () => run(() => notifier.startPreviewTrip(rideId)),
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
                  onPressed: () => run(() => notifier.stopPreviewTrip(rideId)),
                  icon: const Icon(Icons.pause),
                  label: const Text('Pause'),
                ),
              OutlinedButton.icon(
                onPressed: () => run(
                  () => notifier.setDelay(
                    rideId,
                    delayed: !ride.isDelayed,
                    reason: ride.isDelayed ? null : 'Heavy traffic on Route 315',
                  ),
                ),
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
