import 'dart:async';

import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';
import '../../domain/ride_status.dart';
import '../../services/location_service.dart';
import '../../services/position_source.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// One ride, from the driver's seat.
///
/// The screen is arranged around a single enormous button, and everything
/// above it exists to answer the question that button asks. A driver looks at
/// this for under a second at a time.
class JobScreen extends ConsumerWidget {
  const JobScreen({super.key, required this.rideId});

  final String rideId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobs = ref.watch(jobsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Ride')),
      body: jobs.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => FailureBlock(
          message: error is Failure ? error.message : 'Please try again.',
          onRetry: () => ref.invalidate(jobsProvider),
        ),
        data: (data) {
          final job = data.where((j) => j.id == rideId).firstOrNull;
          if (job == null) {
            // The ride left the list — finished, or handed to somebody else.
            // Both are ordinary, and neither is an error.
            return const EmptyState(
              icon: Icons.check_circle_outline,
              title: 'This ride is done',
              message:
                  'It is no longer on your list. Go back to see what is next.',
            );
          }
          return _JobBody(job: job);
        },
      ),
    );
  }
}

class _JobBody extends ConsumerWidget {
  const _JobBody({required this.job});

  final Job job;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(DriverSpacing.md),
            children: [
              _Passenger(job: job),
              const SizedBox(height: DriverSpacing.md),
              _Stop(
                icon: Icons.trip_origin,
                title: 'Pick up',
                place: job.pickup,
                at: job.scheduledPickupAt,
              ),
              const SizedBox(height: DriverSpacing.sm),
              _Stop(
                icon: Icons.place_outlined,
                title: 'Drop off',
                place: job.destination,
              ),
              if (job.notesForDriver != null &&
                  job.notesForDriver!.isNotEmpty) ...[
                const SizedBox(height: DriverSpacing.md),
                InfoCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Notes', style: theme.textTheme.labelLarge),
                      const SizedBox(height: DriverSpacing.xs),
                      Text(job.notesForDriver!),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: DriverSpacing.md),
              const _SharingCard(),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(DriverSpacing.md),
            child: _Actions(job: job),
          ),
        ),
      ],
    );
  }
}

class _Passenger extends StatelessWidget {
  const _Passenger({required this.job});

  final Job job;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(job.passengerName, style: theme.textTheme.headlineSmall),
          Text(
            job.status.driverLabel,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (job.wheelchairRequired || job.assistanceRequired) ...[
            const SizedBox(height: DriverSpacing.md),
            Wrap(
              spacing: DriverSpacing.sm,
              runSpacing: DriverSpacing.sm,
              children: [
                if (job.wheelchairRequired)
                  const RequirementChip(
                    icon: Icons.accessible_forward,
                    label: 'Wheelchair',
                  ),
                if (job.assistanceRequired)
                  const RequirementChip(
                    icon: Icons.volunteer_activism_outlined,
                    label: 'Needs help to the door',
                  ),
              ],
            ),
          ],
          if (job.passengerPhone != null) ...[
            const SizedBox(height: DriverSpacing.md),
            // A telephone call from the kerb is what stops a five-minute wait
            // becoming a no-show, so it is a button rather than a line of text
            // to copy out.
            OutlinedButton.icon(
              onPressed: () => _dial(job.passengerPhone!),
              icon: const Icon(Icons.phone),
              label: Text('Call ${job.passengerName}'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _dial(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(' ', ''));
    // Failure is silent on purpose: a device with no dialler is a device where
    // an error about it helps nobody, and the number is on screen anyway.
    await launchUrl(uri);
  }
}

class _Stop extends StatelessWidget {
  const _Stop({
    required this.icon,
    required this.title,
    required this.place,
    this.at,
  });

  final IconData icon;
  final String title;
  final Place place;
  final DateTime? at;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InfoCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: theme.colorScheme.primary),
          const SizedBox(width: DriverSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(title, style: theme.textTheme.labelLarge),
                    if (at != null) ...[
                      const Spacer(),
                      Text(
                        DateFormat.jm().format(at!),
                        style: theme.textTheme.labelLarge,
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: DriverSpacing.xs),
                Text(place.oneLine, style: theme.textTheme.bodyLarge),
                if (place.accessNotes != null &&
                    place.accessNotes!.isNotEmpty) ...[
                  const SizedBox(height: DriverSpacing.xs),
                  // What stops a driver waiting at the wrong entrance while a
                  // passenger waits at the right one.
                  Text(
                    place.accessNotes!,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What the app is doing with the driver's location, said plainly.
///
/// Shown for the same reason the Android notification says it: somebody
/// carrying a phone that is reporting their position is entitled to know it is
/// happening, how recently anything was sent, and — when a dead zone has
/// stopped it — that a backlog is waiting rather than that everything is fine.
class _SharingCard extends ConsumerWidget {
  const _SharingCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final state = ref.watch(sharingStateProvider).value;
    if (state == null) return const SizedBox.shrink();

    if (state.access != LocationAccess.granted) {
      return InfoCard(
        child: Row(
          children: [
            Icon(Icons.location_off_outlined, color: theme.colorScheme.error),
            const SizedBox(width: DriverSpacing.md),
            Expanded(child: Text(_accessMessage(state.access))),
          ],
        ),
      );
    }

    if (!state.sharing) return const SizedBox.shrink();

    return InfoCard(
      child: Row(
        children: [
          Icon(Icons.my_location, color: theme.colorScheme.primary),
          const SizedBox(width: DriverSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Sharing your location with the family',
                  style: theme.textTheme.labelLarge,
                ),
                Text(
                  _detail(state),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _detail(SharingState state) {
    if (state.queued > 0) {
      // The only visible sign of a dead zone. A driver who can see it can
      // mention it, which is how a coverage hole ever gets reported.
      return '${state.queued} update(s) waiting for signal.';
    }
    final cadence = state.cadence;
    if (cadence == null) return 'Up to date.';
    return 'Updating every ${cadence.inSeconds} seconds.';
  }

  String _accessMessage(LocationAccess access) => switch (access) {
    LocationAccess.disabled =>
      'Location is switched off on this phone. The family cannot see where you are.',
    // Asking again does nothing once it is permanently denied, so the app says
    // where to go instead of showing a button that silently fails.
    LocationAccess.blocked =>
      'Location permission is blocked. Turn it on for CareBridge in your phone’s settings.',
    _ => 'CareBridge needs location permission to share your progress.',
  };
}

class _Actions extends ConsumerWidget {
  const _Actions({required this.job});

  final Job job;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final busy = ref.watch(jobControllerProvider).isLoading;
    final next = job.primaryMove;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (next != null)
          FilledButton(
            onPressed: busy ? null : () => _advance(context, ref, next),
            child: busy
                ? const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(next.actionLabel),
          ),
        if (job.offersNoShow) ...[
          const SizedBox(height: DriverSpacing.sm),
          // Deliberately not a second big button beside the first. This one
          // ends the ride and tells a family their relative did not come out;
          // it is styled apart, and it refuses until the kerbside wait has
          // been served.
          _NoShowButton(job: job),
        ],
      ],
    );
  }

  Future<void> _advance(
    BuildContext context,
    WidgetRef ref,
    RideStatus to,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref
        .read(jobControllerProvider.notifier)
        .advance(job.id, to);

    if (!ok) {
      final error = ref.read(jobControllerProvider).error;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            error is Failure ? error.message : 'That did not go through.',
          ),
        ),
      );
    }
  }
}

/// "Nobody came out", behind a wait and a confirmation.
class _NoShowButton extends ConsumerStatefulWidget {
  const _NoShowButton({required this.job});

  final Job job;

  @override
  ConsumerState<_NoShowButton> createState() => _NoShowButtonState();
}

class _NoShowButtonState extends ConsumerState<_NoShowButton> {
  Timer? _tick;
  late int _remaining = widget.job.noShowAvailableInSeconds ?? 0;

  @override
  void initState() {
    super.initState();
    // Counted down locally between polls. The server decides, but a button
    // that refuses without explaining itself is a button a driver taps four
    // times and then telephones about.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_remaining <= 0) return;
      setState(() => _remaining--);
    });
  }

  @override
  void didUpdateWidget(_NoShowButton old) {
    super.didUpdateWidget(old);
    final fresh = widget.job.noShowAvailableInSeconds;
    if (fresh != null && fresh != old.job.noShowAvailableInSeconds) {
      setState(() => _remaining = fresh);
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ready = _remaining <= 0;

    return OutlinedButton.icon(
      onPressed: ready ? _confirm : null,
      icon: const Icon(Icons.person_off_outlined),
      style: OutlinedButton.styleFrom(foregroundColor: theme.colorScheme.error),
      label: Text(
        ready
            ? 'Nobody came out'
            : 'Nobody came out — wait ${_format(_remaining)}',
      ),
    );
  }

  String _format(int seconds) {
    final minutes = seconds ~/ 60;
    final rest = (seconds % 60).toString().padLeft(2, '0');
    return '$minutes:$rest';
  }

  Future<void> _confirm() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Record a no-show?'),
        content: Text(
          'This ends the ride and tells ${widget.job.passengerName}’s family '
          'that nobody came out. Try calling them first if you have not.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep waiting'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Record no-show'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref
        .read(jobControllerProvider.notifier)
        .advance(widget.job.id, RideStatus.noShow);

    if (!ok) {
      final error = ref.read(jobControllerProvider).error;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            error is Failure ? error.message : 'That did not go through.',
          ),
        ),
      );
    }
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
