import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/status_pill.dart';
import 'demo_controls.dart';
import 'ride_timeline.dart';

class RideDetailScreen extends ConsumerWidget {
  const RideDetailScreen({required this.rideId, super.key});

  final String rideId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final now = ref.watch(clockProvider).now();
    final ride = state.rideById(rideId);
    final theme = Theme.of(context);

    if (ride == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(
          icon: Icons.search_off,
          title: 'Not available',
          message: 'We could not find that, or you do not have access to it.',
        ),
      );
    }

    final patient = state.patientById(ride.patientId);
    final estimate = ride.estimate;

    return Scaffold(
      appBar: AppBar(title: const Text('Ride')),
      body: ListView(
        children: [
          ScreenBody(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              ride.direction.label,
                              style: theme.textTheme.titleLarge,
                            ),
                          ),
                          RideStatusPill(ride.status),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      if (patient != null)
                        InfoRow(
                          icon: Icons.person_outline,
                          label: 'Passenger',
                          value: patient.preferredName,
                        ),
                      InfoRow(
                        icon: Icons.schedule,
                        label: 'Pickup',
                        value: ride.flexibleReturn
                            ? 'Flexible — sent when the visit ends'
                            : '${formatRelativeDay(ride.scheduledPickupAt, now)}, '
                                '${formatTime(ride.scheduledPickupAt)}',
                      ),
                      InfoRow(
                        icon: Icons.trip_origin,
                        label: 'From',
                        value: ride.pickup.singleLine,
                      ),
                      InfoRow(
                        icon: Icons.place_outlined,
                        label: 'To',
                        value: ride.destination.singleLine,
                      ),
                      if (ride.notesForDriver != null)
                        InfoRow(
                          icon: Icons.sticky_note_2_outlined,
                          label: 'Notes for the driver',
                          value: ride.notesForDriver!,
                        ),
                      if (ride.cancellationReason != null)
                        InfoRow(
                          icon: Icons.info_outline,
                          label: 'Reason for cancellation',
                          value: ride.cancellationReason!,
                        ),
                    ],
                  ),
                ),

                if (ride.wheelchairRequired || ride.assistanceRequired) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Requirements for this trip',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.sm,
                          runSpacing: AppSpacing.sm,
                          children: [
                            if (ride.wheelchairRequired)
                              StatusPill(
                                label: 'Wheelchair-accessible vehicle',
                                icon: Icons.accessible_forward,
                                ink: context.infoInk,
                              ),
                            if (ride.assistanceRequired)
                              StatusPill(
                                label: 'Door-through-door assistance',
                                icon: Icons.volunteer_activism_outlined,
                                ink: context.infoInk,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],

                if (ride.driver != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  AppCard(
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 24,
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(ride.driver!.initials),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                ride.driver!.displayName,
                                style: theme.textTheme.titleMedium,
                              ),
                              Text(
                                '${ride.driver!.vehicle.description} · '
                                '${ride.driver!.vehicle.licensePlate}',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: AppSpacing.lg),
                SectionHeader(
                  ride.status.isTerminal ? 'What you paid' : 'Estimated cost',
                  subtitle: 'Priced under rule ${estimate.ruleVersion}.',
                ),
                AppCard(
                  child: Column(
                    children: [
                      _line(context, 'Base fare', estimate.base.format()),
                      if (estimate.distanceMiles > 0) ...[
                        _line(
                          context,
                          'Distance (${estimate.distanceMiles} mi)',
                          estimate.distanceCharge.format(),
                        ),
                        _line(
                          context,
                          'Time (about ${estimate.durationMinutes} min)',
                          estimate.timeCharge.format(),
                        ),
                      ],
                      for (final surcharge in estimate.surcharges)
                        _line(
                          context,
                          surcharge.label,
                          surcharge.amount.format(),
                        ),
                      const Divider(height: AppSpacing.lg),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Total',
                              style: theme.textTheme.titleMedium,
                            ),
                          ),
                          Text(
                            estimate.total.format(),
                            style: theme.textTheme.titleLarge,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('Timeline'),
                RideTimeline(events: ride.events),

                if (ride.isTrackable) ...[
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton.icon(
                    onPressed: () => context.push('/rides/$rideId/track'),
                    icon: const Icon(Icons.my_location),
                    label: const Text('Follow the trip'),
                  ),
                ],

                if (ride.isActive) ...[
                  const SizedBox(height: AppSpacing.lg),
                  DemoControls(rideId: rideId),
                  const SizedBox(height: AppSpacing.md),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.colorScheme.error,
                      side: BorderSide(
                        color: theme.colorScheme.error,
                        width: 1.5,
                      ),
                    ),
                    onPressed: () async {
                      final confirmed = await confirmAction(
                        context,
                        title: 'Cancel this ride?',
                        message:
                            'The driver will be told not to come. You can book '
                            'another ride afterwards.',
                        confirmLabel: 'Cancel the ride',
                      );
                      if (!confirmed || !context.mounted) return;
                      try {
                        ref
                            .read(careProvider.notifier)
                            .cancelRide(rideId, 'Cancelled by family');
                        if (context.mounted) {
                          showConfirmationBanner(context, 'Ride cancelled.');
                        }
                      } catch (error) {
                        if (context.mounted) showFailure(context, error);
                      }
                    },
                    icon: const Icon(Icons.cancel_outlined),
                    label: const Text('Cancel this ride'),
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _line(BuildContext context, String label, String value) {
    final style = Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}
