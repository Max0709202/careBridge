import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../domain/appointment_status.dart';
import '../domain/ride_status.dart';

/// A status indicator that never relies on colour alone.
///
/// WCAG 1.4.1: colour must not be the only way information is conveyed. Every
/// pill carries an icon *and* a word, so it still reads correctly in greyscale,
/// for a colour-blind user, or on a washed-out screen in daylight.
class StatusPill extends StatelessWidget {
  const StatusPill({
    required this.label,
    required this.icon,
    required this.ink,
    this.emphasis = StatusEmphasis.filled,
    super.key,
  });

  final String label;
  final IconData icon;
  final Color ink;
  final StatusEmphasis emphasis;

  @override
  Widget build(BuildContext context) {
    final filled = emphasis == StatusEmphasis.filled;
    return Semantics(
      label: 'Status: $label',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm + 2,
          vertical: 6,
        ),
        decoration: BoxDecoration(
          color: filled ? context.containerFor(ink) : Colors.transparent,
          borderRadius: const BorderRadius.all(Radius.circular(999)),
          border: Border.all(
            color: filled ? Colors.transparent : ink.withValues(alpha: 0.5),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 17, color: ink),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: ink,
                      fontWeight: FontWeight.w700,
                    ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum StatusEmphasis { filled, outlined }

typedef StatusVisual = ({IconData icon, Color ink});

StatusVisual rideStatusVisual(BuildContext context, RideStatus status) =>
    switch (status) {
      RideStatus.draft => (icon: Icons.edit_note, ink: context.neutralInk),
      RideStatus.requested => (
          icon: Icons.hourglass_empty,
          ink: context.infoInk,
        ),
      RideStatus.awaitingAssignment => (
          icon: Icons.search,
          ink: context.infoInk,
        ),
      RideStatus.assigned => (
          icon: Icons.person_pin_circle_outlined,
          ink: context.infoInk,
        ),
      RideStatus.driverAccepted => (
          icon: Icons.check_circle_outline,
          ink: context.infoInk,
        ),
      RideStatus.driverEnRoute => (
          icon: Icons.directions_car_filled_outlined,
          ink: context.infoInk,
        ),
      RideStatus.driverArrived => (
          icon: Icons.pin_drop_outlined,
          ink: context.cautionInk,
        ),
      RideStatus.passengerOnboard => (
          icon: Icons.event_seat_outlined,
          ink: context.positiveInk,
        ),
      RideStatus.inProgress => (
          icon: Icons.navigation_outlined,
          ink: context.positiveInk,
        ),
      RideStatus.arrivedAtDestination => (
          icon: Icons.local_hospital_outlined,
          ink: context.positiveInk,
        ),
      RideStatus.completed => (
          icon: Icons.task_alt,
          ink: context.positiveInk,
        ),
      RideStatus.canceled => (icon: Icons.cancel_outlined, ink: context.neutralInk),
      RideStatus.noShow => (
          icon: Icons.error_outline,
          ink: context.criticalInk,
        ),
      RideStatus.reassignmentRequired => (
          icon: Icons.sync_problem_outlined,
          ink: context.criticalInk,
        ),
    };

StatusVisual appointmentStatusVisual(
  BuildContext context,
  AppointmentStatus status,
) =>
    switch (status) {
      AppointmentStatus.draft => (icon: Icons.edit_note, ink: context.neutralInk),
      AppointmentStatus.scheduled => (
          icon: Icons.event_outlined,
          ink: context.infoInk,
        ),
      AppointmentStatus.confirmed => (
          icon: Icons.event_available_outlined,
          ink: context.infoInk,
        ),
      AppointmentStatus.patientPreparing => (
          icon: Icons.access_time,
          ink: context.cautionInk,
        ),
      AppointmentStatus.transportationScheduled => (
          icon: Icons.directions_car_outlined,
          ink: context.infoInk,
        ),
      AppointmentStatus.patientEnRoute => (
          icon: Icons.navigation_outlined,
          ink: context.positiveInk,
        ),
      AppointmentStatus.patientArrived => (
          icon: Icons.local_hospital_outlined,
          ink: context.positiveInk,
        ),
      AppointmentStatus.completed => (icon: Icons.task_alt, ink: context.positiveInk),
      AppointmentStatus.canceled => (
          icon: Icons.cancel_outlined,
          ink: context.neutralInk,
        ),
      AppointmentStatus.missed => (
          icon: Icons.error_outline,
          ink: context.criticalInk,
        ),
    };

class RideStatusPill extends StatelessWidget {
  const RideStatusPill(this.status, {this.emphasis = StatusEmphasis.filled, super.key});

  final RideStatus status;
  final StatusEmphasis emphasis;

  @override
  Widget build(BuildContext context) {
    final visual = rideStatusVisual(context, status);
    return StatusPill(
      label: status.label,
      icon: visual.icon,
      ink: visual.ink,
      emphasis: emphasis,
    );
  }
}

class AppointmentStatusPill extends StatelessWidget {
  const AppointmentStatusPill(
    this.status, {
    this.emphasis = StatusEmphasis.filled,
    super.key,
  });

  final AppointmentStatus status;
  final StatusEmphasis emphasis;

  @override
  Widget build(BuildContext context) {
    final visual = appointmentStatusVisual(context, status);
    return StatusPill(
      label: status.label,
      icon: visual.icon,
      ink: visual.ink,
      emphasis: emphasis,
    );
  }
}
