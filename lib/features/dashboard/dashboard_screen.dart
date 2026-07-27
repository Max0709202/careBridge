import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../data/care_state.dart';
import '../../domain/models.dart';
import '../../domain/permissions.dart';
import '../../domain/ride_status.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/status_pill.dart';
import '../patients/patient_switcher.dart';

/// The home screen.
///
/// It answers three questions without the reader having to do anything: what is
/// next, is it on track, and what do I do if it is not. Everything else is
/// secondary and lives below.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final clock = ref.watch(clockProvider);
    final now = clock.now();
    final theme = Theme.of(context);
    final patient = state.selectedPatient;

    if (patient == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('CareBridge')),
        body: EmptyState(
          icon: Icons.person_add_alt_1_outlined,
          title: 'Add the person you care for',
          message: 'Create a profile with their address, how they get about, '
              'and who to call in an emergency. Everything else builds on it.',
          action: FilledButton.icon(
            onPressed: () => context.push('/patients/new'),
            icon: const Icon(Icons.add),
            label: const Text('Add a profile'),
          ),
        ),
      );
    }

    final activeRide = state.activeRideFor(patient.id);
    final nextAppointment = state.nextAppointmentFor(patient.id, now);

    return Scaffold(
      appBar: AppBar(
        title: const Text('CareBridge'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
            onPressed: () => context.go('/settings'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {},
        child: ListView(
          children: [
            ScreenBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const PatientSwitcher(),
                  const SizedBox(height: AppSpacing.lg),
                  if (activeRide != null) ...[
                    _ActiveRideCard(ride: activeRide, patient: patient),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                  _NextAppointmentSection(
                    appointment: nextAppointment,
                    state: state,
                    now: now,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  SectionHeader(
                    'Quick actions',
                    subtitle: 'For ${patient.preferredName}',
                  ),
                  _QuickActions(patient: patient, state: state),
                  const SizedBox(height: AppSpacing.lg),
                  _EmergencyContactCard(patient: patient),
                  const SizedBox(height: AppSpacing.lg),
                  SectionHeader(
                    'Recent activity',
                    action: TextButton(
                      onPressed: () => context.go('/appointments'),
                      child: const Text('See all'),
                    ),
                  ),
                  _RecentActivity(state: state, patient: patient, now: now),
                  const SizedBox(height: AppSpacing.xl),
                  Text(
                    'CareBridge coordinates appointments and transport. It is '
                    'not for emergencies — in an emergency, call 911.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The card that replaces a phone call to dispatch.
class _ActiveRideCard extends ConsumerWidget {
  const _ActiveRideCard({required this.ride, required this.patient});

  final Ride ride;
  final Patient patient;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final visual = rideStatusVisual(context, ride.status);
    final trackable = ride.isTrackable;

    return AppCard(
      borderColor: ride.isDelayed ? context.cautionInk : visual.ink,
      semanticLabel: 'Current ride for ${patient.preferredName}. '
          'Status: ${ride.status.label}.',
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
          if (ride.isDelayed) ...[
            const SizedBox(height: AppSpacing.sm),
            _DelayBanner(reason: ride.delayReason),
          ],
          const SizedBox(height: AppSpacing.md),
          if (ride.driver != null)
            _DriverRow(driver: ride.driver!)
          else
            Text(
              ride.status == RideStatus.awaitingAssignment
                  ? 'We are finding a driver. You will be notified as soon as '
                      'one is assigned.'
                  : 'No driver assigned yet.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          if (trackable && ride.etaMinutes != null)
            _EtaLine(ride: ride)
          else
            InfoRow(
              icon: Icons.schedule,
              label: 'Pickup',
              value: ride.flexibleReturn
                  ? 'When the visit ends'
                  : '${formatRelativeDay(ride.scheduledPickupAt, ref.watch(clockProvider).now())}, '
                      '${formatTime(ride.scheduledPickupAt)}',
            ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => context.push(
                    trackable ? '/rides/${ride.id}/track' : '/rides/${ride.id}',
                  ),
                  icon: Icon(
                    trackable ? Icons.my_location : Icons.receipt_long_outlined,
                  ),
                  label: Text(trackable ? 'Follow the trip' : 'Ride details'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EtaLine extends ConsumerWidget {
  const _EtaLine({required this.ride});

  final Ride ride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Rebuilds once a second so the freshness age stays truthful.
    ref.watch(tickerProvider);
    final now = ref.watch(clockProvider).now();
    final theme = Theme.of(context);
    final position = ride.lastKnownPosition;
    final age = position == null
        ? null
        : now.difference(position.capturedAt);
    final stale = age != null && age.inSeconds > 45;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.timer_outlined, size: 22, color: context.infoInk),
            const SizedBox(width: AppSpacing.sm),
            Text(
              ride.status.passengerIsOnboard
                  ? 'Arriving in about ${ride.etaMinutes} min'
                  : 'Driver is about ${ride.etaMinutes} min away',
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
        if (age != null) ...[
          const SizedBox(height: AppSpacing.xs),
          Text(
            stale
                ? 'Location last updated ${formatFreshness(age)} — this may be out of date.'
                : 'Location updated ${formatFreshness(age)}.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: stale ? context.cautionInk : theme.colorScheme.onSurfaceVariant,
              fontWeight: stale ? FontWeight.w700 : null,
            ),
          ),
        ],
      ],
    );
  }
}

class _DelayBanner extends StatelessWidget {
  const _DelayBanner({this.reason});

  final String? reason;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm + 4),
      decoration: BoxDecoration(
        color: context.containerFor(context.cautionInk),
        borderRadius: AppRadius.controlAll,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, color: context.cautionInk),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              reason == null
                  ? 'This ride is running late.'
                  : 'Running late — $reason',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: context.cautionInk,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverRow extends StatelessWidget {
  const _DriverRow({required this.driver});

  final Driver driver;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Text(
            driver.initials,
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(driver.displayName, style: theme.textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(
                '${driver.vehicle.description} · ${driver.vehicle.licensePlate}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (driver.vehicle.isWheelchairAccessible)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: StatusPill(
                    label: 'Wheelchair accessible',
                    icon: Icons.accessible_forward,
                    ink: context.positiveInk,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _NextAppointmentSection extends StatelessWidget {
  const _NextAppointmentSection({
    required this.appointment,
    required this.state,
    required this.now,
  });

  final Appointment? appointment;
  final CareState state;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (appointment == null) {
      return AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('No appointments coming up', style: theme.textTheme.titleMedium),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'When you add one, it will show here with its transport status.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            FilledButton.icon(
              onPressed: () => context.push('/appointments/new'),
              icon: const Icon(Icons.add),
              label: const Text('Add an appointment'),
            ),
          ],
        ),
      );
    }

    final clinic = state.clinicById(appointment!.clinicId);
    final until = appointment!.startsAt.difference(now);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('Next appointment'),
        AppCard(
          onTap: () => context.push('/appointments/${appointment!.id}'),
          semanticLabel: 'Next appointment, '
              '${formatAppointmentWhen(appointment!.startsAt, appointment!.timeZoneLabel)}, '
              'at ${clinic?.name ?? 'a clinic'}.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      formatRelativeDay(appointment!.startsAt, now),
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                  AppointmentStatusPill(appointment!.status),
                ],
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                '${formatTime(appointment!.startsAt)} · ${appointment!.timeZoneLabel}',
                style: theme.textTheme.headlineSmall,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                clinic?.name ?? 'Clinic',
                style: theme.textTheme.bodyLarge,
              ),
              Text(
                appointment!.type.label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                formatCountdown(until),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.patient, required this.state});

  final Patient patient;
  final CareState state;

  @override
  Widget build(BuildContext context) {
    final canSchedule =
        state.can(patient.id, FamilyPermission.scheduleAppointments);
    final canTransport =
        state.can(patient.id, FamilyPermission.requestTransport);

    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        if (canSchedule)
          FilledButton.tonalIcon(
            onPressed: () => context.push('/appointments/new'),
            icon: const Icon(Icons.event_outlined),
            label: const Text('Add appointment'),
          ),
        if (canTransport)
          FilledButton.tonalIcon(
            onPressed: () => context.go('/appointments'),
            icon: const Icon(Icons.directions_car_outlined),
            label: const Text('Request transport'),
          ),
        OutlinedButton.icon(
          onPressed: () => context.push('/patients/${patient.id}'),
          icon: const Icon(Icons.person_outline),
          label: const Text('Profile'),
        ),
      ],
    );
  }
}

class _EmergencyContactCard extends StatelessWidget {
  const _EmergencyContactCard({required this.patient});

  final Patient patient;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = patient.emergencyContacts.where((c) => c.isPrimary).firstOrNull ??
        patient.emergencyContacts.firstOrNull;

    if (primary == null) return const SizedBox.shrink();

    return AppCard(
      child: Row(
        children: [
          Icon(Icons.contact_phone_outlined, color: theme.colorScheme.primary),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Emergency contact',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${primary.name} · ${primary.relationship}',
                  style: theme.textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentActivity extends StatelessWidget {
  const _RecentActivity({
    required this.state,
    required this.patient,
    required this.now,
  });

  final CareState state;
  final Patient patient;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rides = state
        .ridesFor(patient.id)
        .where((r) => r.status.isTerminal)
        .toList()
      ..sort((a, b) => b.scheduledPickupAt.compareTo(a.scheduledPickupAt));

    if (rides.isEmpty) {
      return Text(
        'Completed rides will appear here.',
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      );
    }

    return Column(
      children: [
        for (final ride in rides.take(3))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              onTap: () => context.push('/rides/${ride.id}'),
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          formatRelativeDay(ride.scheduledPickupAt, now),
                          style: theme.textTheme.bodyLarge,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${ride.direction.label} · ${ride.estimate.total.format()}',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  RideStatusPill(ride.status, emphasis: StatusEmphasis.outlined),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
