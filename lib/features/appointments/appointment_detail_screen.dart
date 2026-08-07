import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../domain/models.dart';
import '../../domain/permissions.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/status_pill.dart';

class AppointmentDetailScreen extends ConsumerWidget {
  const AppointmentDetailScreen({required this.appointmentId, super.key});

  final String appointmentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final now = ref.watch(clockProvider).now();
    final appointment = state.appointmentById(appointmentId);
    final theme = Theme.of(context);

    if (appointment == null || !state.canView(appointment.patientId)) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(
          icon: Icons.search_off,
          title: 'Not available',
          message: 'We could not find that, or you do not have access to it.',
        ),
      );
    }

    final clinic = state.clinicById(appointment.clinicId);
    final patient = state.patientById(appointment.patientId);
    final rides = state.ridesForAppointment(appointmentId);
    final canSchedule =
        state.can(appointment.patientId, FamilyPermission.scheduleAppointments);
    final canTransport =
        state.can(appointment.patientId, FamilyPermission.requestTransport);
    final hasActiveRide = rides.any((r) => r.isActive);

    return Scaffold(
      appBar: AppBar(title: const Text('Appointment')),
      body: SingleChildScrollView(
        child: ScreenBody(
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
                            formatRelativeDay(appointment.startsAt, now),
                            style: theme.textTheme.titleMedium,
                          ),
                        ),
                        AppointmentStatusPill(appointment.status),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      formatTime(appointment.startsAt),
                      style: theme.textTheme.displaySmall,
                    ),
                    Text(
                      '${appointment.timeZoneLabel} · '
                      '${formatDuration(appointment.expectedDuration)}',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const Divider(height: AppSpacing.lg),
                    InfoRow(
                      icon: Icons.person_outline,
                      label: 'For',
                      value: patient?.preferredName ?? 'Unknown',
                    ),
                    InfoRow(
                      icon: Icons.local_hospital_outlined,
                      label: 'Clinic',
                      value: clinic?.name ?? 'Unknown clinic',
                    ),
                    if (clinic != null)
                      InfoRow(
                        icon: Icons.place_outlined,
                        label: 'Address',
                        value: clinic.address.singleLine,
                      ),
                    if (clinic?.entranceNotes != null)
                      InfoRow(
                        icon: Icons.door_front_door_outlined,
                        label: 'Where the car should stop',
                        value: clinic!.entranceNotes!,
                      ),
                    InfoRow(
                      icon: Icons.category_outlined,
                      label: 'Visit type',
                      value: appointment.type.label,
                    ),
                    if (appointment.coordinationNotes != null)
                      InfoRow(
                        icon: Icons.sticky_note_2_outlined,
                        label: 'Notes',
                        value: appointment.coordinationNotes!,
                      ),
                  ],
                ),
              ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('Transportation'),
              if (rides.isEmpty)
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'No ride booked yet',
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        appointment.transportRequired
                            ? 'This appointment is marked as needing a ride.'
                            : 'Book one if they need a lift there and back.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      if (canTransport && appointment.status.isUpcoming) ...[
                        const SizedBox(height: AppSpacing.md),
                        FilledButton.icon(
                          onPressed: () => context.push(
                            '/appointments/$appointmentId/transport',
                          ),
                          icon: const Icon(Icons.directions_car_outlined),
                          label: const Text('Arrange transportation'),
                        ),
                      ],
                    ],
                  ),
                )
              else
                for (final ride in rides)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: _RideSummaryCard(ride: ride, now: now),
                  ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader(
                'History',
                subtitle: 'Every change is recorded, with who made it.',
              ),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (appointment.history.isEmpty)
                      Text(
                        'No changes recorded yet.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      for (final change in appointment.history.reversed)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.history,
                                size: 18,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: AppSpacing.sm + 4),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      change.reason ??
                                          'Status changed to ${change.to}',
                                      style: theme.textTheme.bodyMedium,
                                    ),
                                    Text(
                                      '${formatShortDay(change.at)}, '
                                      '${formatTime(change.at)} · ${change.actor}',
                                      style: theme.textTheme.bodySmall?.copyWith(
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
                ),
              ),

              if (canSchedule && appointment.status.isUpcoming) ...[
                const SizedBox(height: AppSpacing.lg),
                OutlinedButton.icon(
                  onPressed: () => _reschedule(context, ref, appointment),
                  icon: const Icon(Icons.edit_calendar_outlined),
                  label: const Text('Reschedule'),
                ),
                const SizedBox(height: AppSpacing.sm),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.colorScheme.error,
                    side: BorderSide(color: theme.colorScheme.error, width: 1.5),
                  ),
                  onPressed: () =>
                      _cancel(context, ref, appointment, hasActiveRide),
                  icon: const Icon(Icons.event_busy_outlined),
                  label: const Text('Cancel appointment'),
                ),
              ],
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _reschedule(
    BuildContext context,
    WidgetRef ref,
    Appointment appointment,
  ) async {
    final now = ref.read(clockProvider).now();
    final date = await showDatePicker(
      context: context,
      initialDate: appointment.startsAt.isAfter(now) ? appointment.startsAt : now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      helpText: 'New date',
    );
    if (date == null || !context.mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(appointment.startsAt),
      helpText: 'New time',
    );
    if (time == null || !context.mounted) return;

    try {
      ref.read(careProvider.notifier).rescheduleAppointment(
            appointment.id,
            DateTime(date.year, date.month, date.day, time.hour, time.minute),
          );
      if (context.mounted) {
        showConfirmationBanner(context, 'Appointment rescheduled.');
      }
    } catch (error) {
      if (context.mounted) showFailure(context, error);
    }
  }

  Future<void> _cancel(
    BuildContext context,
    WidgetRef ref,
    Appointment appointment,
    bool hasActiveRide,
  ) async {
    final confirmed = await confirmAction(
      context,
      title: 'Cancel this appointment?',
      message: hasActiveRide
          ? 'The booked transportation will be cancelled too, so no car is sent '
              'for an appointment that is not happening.'
          : 'This cannot be undone. Everyone with access will be notified.',
      confirmLabel: 'Cancel appointment',
      cancelLabel: 'Keep it',
    );
    if (!confirmed || !context.mounted) return;

    try {
      ref.read(careProvider.notifier).cancelAppointment(appointment.id);
      if (context.mounted) {
        showConfirmationBanner(context, 'Appointment cancelled.');
        context.pop();
      }
    } catch (error) {
      if (context.mounted) showFailure(context, error);
    }
  }
}

class _RideSummaryCard extends StatelessWidget {
  const _RideSummaryCard({required this.ride, required this.now});

  final Ride ride;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AppCard(
      onTap: () => context.push(
        ride.isTrackable ? '/rides/${ride.id}/track' : '/rides/${ride.id}',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  ride.direction.label,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              RideStatusPill(ride.status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            ride.flexibleReturn
                ? 'Pickup when the visit ends'
                : 'Pickup ${formatRelativeDay(ride.scheduledPickupAt, now)} at '
                    '${formatTime(ride.scheduledPickupAt)}',
            style: theme.textTheme.bodyMedium,
          ),
          if (ride.driver != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${ride.driver!.displayName} · '
                '${ride.driver!.vehicle.description}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
