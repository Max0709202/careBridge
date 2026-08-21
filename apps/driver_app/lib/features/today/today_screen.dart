import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The shift, and what is on it.
///
/// The whole screen answers one question at a time: are you working, and what
/// is next. A driver reads this in a car park before setting off and does not
/// read it again until something changes.
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Today'),
        actions: [
          IconButton(
            tooltip: 'Your paperwork',
            onPressed: () => context.push('/documents'),
            icon: const Icon(Icons.folder_outlined),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: profile.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _profileError(context, ref, error),
        data: (data) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(profileProvider);
            ref.invalidate(jobsProvider);
          },
          child: ListView(
            padding: const EdgeInsets.all(DriverSpacing.md),
            children: [
              _ShiftCard(profile: data),
              const SizedBox(height: DriverSpacing.md),
              const _JobList(),
            ],
          ),
        ),
      ),
    );
  }

  /// A 404 here is not a fault to shout about.
  ///
  /// It means this account is not on anybody's roster — which is exactly what
  /// a family member who installed the wrong app would see, and what a new
  /// driver sees before their operator has recorded their address. Both
  /// deserve a sentence, not a red error.
  Widget _profileError(BuildContext context, WidgetRef ref, Object error) {
    if (error is NotFoundFailure) {
      return EmptyState(
        icon: Icons.badge_outlined,
        title: 'No driver profile yet',
        message:
            'This account is not on an operator’s roster. Ask your dispatcher '
            'to add you with this email address, and make sure you have '
            'confirmed it — we only join the two once the address is verified.',
        action: OutlinedButton.icon(
          onPressed: () => ref.invalidate(profileProvider),
          icon: const Icon(Icons.refresh),
          label: const Text('Check again'),
        ),
      );
    }

    return FailureBlock(
      message: error is Failure ? error.message : 'Please try again.',
      onRetry: () => ref.invalidate(profileProvider),
    );
  }
}

class _ShiftCard extends ConsumerWidget {
  const _ShiftCard({required this.profile});

  final DriverProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final busy = ref.watch(shiftControllerProvider).isLoading;

    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(profile.displayName, style: theme.textTheme.titleLarge),
          Text(
            profile.organizationName,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: DriverSpacing.sm),
          Text(
            '${profile.vehicle.description} · ${profile.vehicle.licensePlate}',
            style: theme.textTheme.bodyMedium,
          ),
          if (profile.suspensionReason != null) ...[
            const SizedBox(height: DriverSpacing.md),
            // Said out loud. Being locked out of your own job with no reason
            // given is how a support queue fills up.
            Text(
              'Suspended: ${profile.suspensionReason}',
              style: TextStyle(
                color: theme.colorScheme.error,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(height: DriverSpacing.md),
          if (profile.canWork)
            FilledButton.icon(
              onPressed: busy ? null : () => _toggle(context, ref),
              icon: Icon(
                profile.onShift ? Icons.stop_circle_outlined : Icons.play_arrow,
              ),
              label: Text(profile.onShift ? 'End shift' : 'Start shift'),
              style: profile.onShift
                  ? FilledButton.styleFrom(
                      backgroundColor: theme.colorScheme.secondaryContainer,
                      foregroundColor: theme.colorScheme.onSecondaryContainer,
                    )
                  : null,
            )
          else ...[
            Text(
              'Your operator has not approved you to drive yet.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: DriverSpacing.sm),
            // The next thing to do, rather than a dead end. Approval waits on
            // paperwork far more often than on anything else.
            OutlinedButton.icon(
              onPressed: () => context.push('/documents'),
              icon: const Icon(Icons.folder_outlined),
              label: const Text('Check your paperwork'),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _toggle(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final failure = await ref
        .read(shiftControllerProvider.notifier)
        .setShift(!profile.onShift);

    // The server refuses an end-of-shift with a passenger in the car, and says
    // why. Shown rather than swallowed: a button that silently does nothing is
    // indistinguishable from a broken one.
    if (failure != null) {
      messenger.showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }
}

class _JobList extends ConsumerWidget {
  const _JobList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobs = ref.watch(jobsProvider);

    return jobs.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(DriverSpacing.xl),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => FailureBlock(
        message: error is Failure ? error.message : 'Please try again.',
        onRetry: () => ref.invalidate(jobsProvider),
      ),
      data: (data) => data.isEmpty
          ? const EmptyState(
              icon: Icons.event_available_outlined,
              title: 'Nothing assigned',
              message:
                  'Your dispatcher will send work here. The screen refreshes '
                  'on its own — there is no need to keep checking.',
            )
          : Column(
              children: [
                for (final job in data) ...[
                  _JobRow(job: job),
                  const SizedBox(height: DriverSpacing.sm),
                ],
              ],
            ),
    );
  }
}

class _JobRow extends StatelessWidget {
  const _JobRow({required this.job});

  final Job job;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () => context.push('/job/${job.id}'),
      borderRadius: DriverRadius.cardAll,
      child: InfoCard(
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    DateFormat.jm().format(job.scheduledPickupAt),
                    style: theme.textTheme.titleMedium,
                  ),
                  Text(job.passengerName, style: theme.textTheme.titleLarge),
                  const SizedBox(height: DriverSpacing.xs),
                  Text(
                    job.pickup.oneLine,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: DriverSpacing.sm),
                  Text(
                    job.status.driverLabel,
                    style: theme.textTheme.labelLarge,
                  ),
                ],
              ),
            ),
            if (job.wheelchairRequired)
              const Padding(
                padding: EdgeInsets.only(left: DriverSpacing.sm),
                child: Icon(Icons.accessible_forward, size: 28),
              ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
