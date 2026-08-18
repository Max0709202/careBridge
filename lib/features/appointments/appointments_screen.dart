import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../data/care_state.dart';
import '../../domain/models.dart';
import '../../domain/permissions.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/status_pill.dart';

class AppointmentsScreen extends ConsumerWidget {
  const AppointmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final now = ref.watch(clockProvider).now();
    final patient = state.selectedPatient;

    if (patient == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Appointments')),
        body: EmptyState(
          icon: Icons.person_add_alt_1_outlined,
          title: 'Add someone first',
          message: 'Appointments belong to a person. Add a profile to begin.',
          action: FilledButton(
            onPressed: () => context.push('/patients/new'),
            child: const Text('Add a profile'),
          ),
        ),
      );
    }

    final upcoming = state.upcomingFor(patient.id, now);
    final past = state.pastFor(patient.id, now);
    final canSchedule = state.can(
      patient.id,
      FamilyPermission.scheduleAppointments,
    );

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text('${patient.preferredName}’s appointments'),
          bottom: TabBar(
            tabs: [
              Tab(text: 'Upcoming (${upcoming.length})'),
              Tab(text: 'Past (${past.length})'),
            ],
          ),
        ),
        floatingActionButton: canSchedule
            ? FloatingActionButton.extended(
                onPressed: () => context.push('/appointments/new'),
                icon: const Icon(Icons.add),
                label: const Text('Add'),
              )
            : null,
        body: TabBarView(
          children: [
            _AppointmentList(
              appointments: upcoming,
              state: state,
              now: now,
              emptyTitle: 'Nothing scheduled',
              emptyMessage:
                  'Add an appointment and CareBridge will handle reminders and '
                  'the ride there.',
              canSchedule: canSchedule,
            ),
            _AppointmentList(
              appointments: past,
              state: state,
              now: now,
              emptyTitle: 'No history yet',
              emptyMessage: 'Completed and cancelled appointments appear here.',
              canSchedule: false,
            ),
          ],
        ),
      ),
    );
  }
}

class _AppointmentList extends StatelessWidget {
  const _AppointmentList({
    required this.appointments,
    required this.state,
    required this.now,
    required this.emptyTitle,
    required this.emptyMessage,
    required this.canSchedule,
  });

  final List<Appointment> appointments;
  final CareState state;
  final DateTime now;
  final String emptyTitle;
  final String emptyMessage;
  final bool canSchedule;

  @override
  Widget build(BuildContext context) {
    if (appointments.isEmpty) {
      return EmptyState(
        icon: Icons.event_note_outlined,
        title: emptyTitle,
        message: emptyMessage,
        action: canSchedule
            ? FilledButton.icon(
                onPressed: () => context.push('/appointments/new'),
                icon: const Icon(Icons.add),
                label: const Text('Add an appointment'),
              )
            : null,
      );
    }

    return ListView(
      children: [
        ScreenBody(
          child: Column(
            children: [
              for (final appointment in appointments)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _AppointmentTile(
                    appointment: appointment,
                    state: state,
                    now: now,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AppointmentTile extends StatelessWidget {
  const _AppointmentTile({
    required this.appointment,
    required this.state,
    required this.now,
  });

  final Appointment appointment;
  final CareState state;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final clinic = state.clinicById(appointment.clinicId);
    final rides = state.ridesForAppointment(appointment.id);
    final activeRide = rides.where((r) => r.isActive).firstOrNull;

    return AppCard(
      onTap: () => context.push('/appointments/${appointment.id}'),
      semanticLabel:
          '${formatAppointmentWhen(appointment.startsAt, appointment.timeZoneLabel)} '
          'at ${clinic?.name ?? 'a clinic'}. Status ${appointment.status.label}.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      formatRelativeDay(appointment.startsAt, now),
                      style: theme.textTheme.titleMedium,
                    ),
                    Text(
                      '${formatTime(appointment.startsAt)} · '
                      '${formatDuration(appointment.expectedDuration)}',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              AppointmentStatusPill(appointment.status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(clinic?.name ?? 'Clinic', style: theme.textTheme.bodyLarge),
          Text(
            appointment.type.label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (activeRide != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Icon(
                  Icons.directions_car_outlined,
                  size: 20,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Transport: ${activeRide.status.label}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
          ] else if (appointment.status.isUpcoming) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Icon(
                  Icons.no_transfer_outlined,
                  size: 20,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'No transport booked',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
