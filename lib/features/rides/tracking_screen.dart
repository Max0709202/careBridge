import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../domain/models.dart';
import '../../domain/ride_status.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/status_pill.dart';
import 'demo_controls.dart';
import 'ride_timeline.dart';
import 'route_map.dart';

/// Live tracking.
///
/// The screen exists to answer one question — *is the person I love all right
/// right now* — and its hardest requirement is honesty. Three rules follow:
///
/// * Position is aged against `capturedAt` (when the device took the reading),
///   never against when we received it.
/// * Past [_staleAfter] the screen says so, in words, at the top. Past
///   [_lostAfter] it stops presenting a position as current at all.
/// * ETA is shown as "about N minutes", never a clock time, because we do not
///   have routing data good enough to promise one.
class TrackingScreen extends ConsumerWidget {
  const TrackingScreen({required this.rideId, super.key});

  final String rideId;

  /// The same thresholds the write path enforces — see [TrackingFreshness].
  /// One definition, so what we refuse to store and what we refuse to show can
  /// never drift apart.
  static const _staleAfter = TrackingFreshness.stale;
  static const _lostAfter = TrackingFreshness.lost;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Rebuild every second so the freshness age cannot silently go out of date.
    ref.watch(tickerProvider);

    final state = ref.watch(careProvider);
    final now = ref.watch(clockProvider).now();
    final ride = state.rideById(rideId);
    final theme = Theme.of(context);

    // Live position is the most sensitive thing this app renders — where a
    // vulnerable person physically is, right now. The grant is checked before
    // anything is drawn, and an id alone never gets you here.
    if (ride == null || !state.canView(ride.patientId)) {
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

    // The live stream, preferred over the polled snapshot when it has anything
    // newer. Both are the same shape and both are aged against `capturedAt`,
    // so the choice is only ever "which of these two readings is more recent"
    // — never a different rule for a pushed position than a polled one.
    //
    // The snapshot is the floor rather than a fallback: a socket that has not
    // connected yet, or one the server refused, leaves the screen showing
    // exactly what it showed before live tracking existed.
    final live = ref.watch(liveTrackingProvider(rideId)).value;
    final position = TrackingPoint.newerOf(ride.lastKnownPosition, live?.point);
    final etaMinutes = live?.etaMinutes ?? ride.etaMinutes;
    final age = position == null ? null : now.difference(position.capturedAt);
    final stale = age != null && age > _staleAfter;
    final lost = age != null && age > _lostAfter;

    // Tracking is only legal in certain states; once a ride ends, this screen
    // must not keep presenting a position.
    if (!ride.status.allowsLocationSharing) {
      return _FinishedRideView(ride: ride, rideId: rideId);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          patient == null ? 'Live trip' : '${patient.preferredName}’s trip',
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.receipt_long_outlined),
            tooltip: 'Ride details',
            onPressed: () => context.push('/rides/$rideId'),
          ),
        ],
      ),
      body: ListView(
        children: [
          ScreenBody(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (ride.pickup.coordinates != null &&
                    ride.destination.coordinates != null)
                  RouteMap(
                    pickup: ride.pickup.coordinates!,
                    destination: ride.destination.coordinates!,
                    driver: lost ? null : position?.coordinates,
                    isStale: stale,
                    passengerOnboard: ride.status.passengerIsOnboard,
                  )
                else
                  AppCard(
                    child: Text(
                      'This address has not been verified yet, so the route '
                      'cannot be drawn. Status updates below are unaffected.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),

                const SizedBox(height: AppSpacing.md),
                _FreshnessBanner(age: age, stale: stale, lost: lost),

                const SizedBox(height: AppSpacing.md),
                _StatusHeadline(ride: ride, lost: lost, etaMinutes: etaMinutes),

                if (ride.isDelayed) ...[
                  const SizedBox(height: AppSpacing.md),
                  _DelayCard(reason: ride.delayReason),
                ],

                const SizedBox(height: AppSpacing.lg),
                if (ride.driver != null) _DriverCard(driver: ride.driver!),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('What has happened so far'),
                RideTimeline(events: ride.events),

                const SizedBox(height: AppSpacing.lg),
                DemoControls(rideId: rideId),

                const SizedBox(height: AppSpacing.lg),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.colorScheme.error,
                    side: BorderSide(
                      color: theme.colorScheme.error,
                      width: 1.5,
                    ),
                  ),
                  onPressed: () => _cancel(context, ref, ride),
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Cancel this ride'),
                ),
                const SizedBox(height: AppSpacing.xl),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, Ride ride) async {
    final onboard = ride.status.passengerIsOnboard;
    final confirmed = await confirmAction(
      context,
      title: 'Cancel this ride?',
      message: onboard
          ? 'The passenger is already in the vehicle. Only cancel if you have '
                'spoken to them — the driver will be told to stop.'
          : 'The driver will be told not to come. You can book another ride '
                'afterwards.',
      confirmLabel: 'Cancel the ride',
      cancelLabel: 'Keep it',
    );
    if (!confirmed || !context.mounted) return;

    try {
      await ref
          .read(careProvider.notifier)
          .cancelRide(ride.id, 'Cancelled by family');
      if (context.mounted) {
        showConfirmationBanner(context, 'Ride cancelled.');
        context.pop();
      }
    } catch (error) {
      if (context.mounted) showFailure(context, error);
    }
  }
}

class _FreshnessBanner extends StatelessWidget {
  const _FreshnessBanner({
    required this.age,
    required this.stale,
    required this.lost,
  });

  final Duration? age;
  final bool stale;
  final bool lost;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final (ink, icon, message) = switch ((age, stale, lost)) {
      (null, _, _) => (
        context.neutralInk,
        Icons.location_disabled_outlined,
        'Waiting for the first position report from the driver.',
      ),
      (_, _, true) => (
        context.criticalInk,
        Icons.signal_wifi_statusbar_null_outlined,
        'We have lost contact with the driver’s device. The last position was '
            '${formatFreshness(age!)} and is no longer shown.',
      ),
      (_, true, _) => (
        context.cautionInk,
        Icons.warning_amber_rounded,
        'Position last updated ${formatFreshness(age!)}. It may be out of date.',
      ),
      _ => (
        context.positiveInk,
        Icons.check_circle_outline,
        'Position updated ${formatFreshness(age!)}.',
      ),
    };

    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm + 4),
      decoration: BoxDecoration(
        color: context.containerFor(ink),
        borderRadius: AppRadius.controlAll,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: ink, size: 22),
          const SizedBox(width: AppSpacing.sm + 4),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: ink,
                fontWeight: stale || lost ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusHeadline extends StatelessWidget {
  const _StatusHeadline({
    required this.ride,
    required this.lost,
    required this.etaMinutes,
  });

  final Ride ride;
  final bool lost;

  /// From the live stream where there is one, and from the polled snapshot
  /// otherwise. Passed in rather than read off the ride so the headline cannot
  /// quote an ETA older than the position drawn above it.
  final int? etaMinutes;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final eta = etaMinutes;

    final headline = switch (ride.status) {
      RideStatus.driverEnRoute =>
        lost || eta == null
            ? 'The driver is on the way'
            : 'Driver is about $eta ${eta == 1 ? 'minute' : 'minutes'} away',
      RideStatus.driverArrived => 'The driver is outside',
      RideStatus.passengerOnboard => 'Picked up safely',
      RideStatus.inProgress =>
        lost || eta == null
            ? 'On the way to the clinic'
            : 'Arriving in about $eta ${eta == 1 ? 'minute' : 'minutes'}',
      RideStatus.arrivedAtDestination => 'Arrived at the clinic',
      _ => ride.status.label,
    };

    final support = switch (ride.status) {
      RideStatus.driverArrived =>
        'They are waiting at the pickup address. There is no rush — the driver '
            'has been asked to allow time.',
      RideStatus.passengerOnboard =>
        'They are in the vehicle and the trip has started.',
      RideStatus.arrivedAtDestination =>
        'The vehicle has reached the destination.',
      _ => null,
    };

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RideStatusPill(ride.status),
          const SizedBox(height: AppSpacing.sm + 4),
          Text(headline, style: theme.textTheme.headlineSmall),
          if (support != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              support,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DelayCard extends StatelessWidget {
  const _DelayCard({this.reason});

  final String? reason;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      borderColor: context.cautionInk,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.watch_later_outlined, color: context.cautionInk),
          const SizedBox(width: AppSpacing.sm + 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Running late',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: context.cautionInk,
                  ),
                ),
                if (reason != null)
                  Text(reason!, style: theme.textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver});

  final Driver driver;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Text(
                  driver.initials,
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      driver.displayName,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Icon(Icons.star, size: 16, color: context.cautionInk),
                        const SizedBox(width: 4),
                        Text(
                          '${driver.rating} · ${driver.yearsDriving} years driving',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const Divider(height: AppSpacing.lg),
          InfoRow(
            icon: Icons.directions_car_outlined,
            label: 'Look for',
            value: driver.vehicle.description,
          ),
          InfoRow(
            icon: Icons.pin_outlined,
            label: 'Licence plate',
            value: driver.vehicle.licensePlate,
          ),
          if (driver.vehicle.isWheelchairAccessible)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: StatusPill(
                label: 'Wheelchair accessible',
                icon: Icons.accessible_forward,
                ink: context.positiveInk,
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: () => showConfirmationBanner(
              context,
              'Connecting through a relay number keeps both numbers private — '
              'this arrives with the server.',
            ),
            icon: const Icon(Icons.phone_outlined),
            label: const Text('Call the driver'),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Calls go through a relay number. Neither side sees the other’s '
            'real number.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown when a ride is no longer trackable. Deliberately a different screen:
/// once tracking stops, there is no position to show and nothing should imply
/// otherwise.
class _FinishedRideView extends StatelessWidget {
  const _FinishedRideView({required this.ride, required this.rideId});

  final Ride ride;
  final String rideId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Trip')),
      body: EmptyState(
        icon: ride.status == RideStatus.completed
            ? Icons.task_alt
            : Icons.location_off_outlined,
        title: ride.status == RideStatus.completed
            ? 'This trip is complete'
            : 'Tracking has stopped',
        message: ride.status == RideStatus.completed
            ? 'Location sharing ended when the trip finished. The full timeline '
                  'is on the ride details.'
            : 'This ride is ${ride.status.label.toLowerCase()}, so the driver is '
                  'no longer sharing location.',
        action: FilledButton(
          onPressed: () => context.pushReplacement('/rides/$rideId'),
          child: const Text('See ride details'),
        ),
      ),
    );
  }
}
