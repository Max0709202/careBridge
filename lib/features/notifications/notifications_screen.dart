import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final now = ref.watch(clockProvider).now();
    final notifications = state.notificationsNewestFirst;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Updates'),
        actions: [
          if (state.unreadNotificationCount > 0)
            TextButton(
              onPressed: () async {
                try {
                  await ref
                      .read(careProvider.notifier)
                      .markAllNotificationsRead();
                } catch (error) {
                  if (context.mounted) showFailure(context, error);
                }
              },
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: notifications.isEmpty
          ? const EmptyState(
              icon: Icons.notifications_none,
              title: 'Nothing to report',
              message: 'Updates about appointments and rides appear here, and '
                  'as notifications on your phone.',
            )
          : ListView(
              children: [
                ScreenBody(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Text(
                          'Updates never include a name, a clinic, an address '
                          'or a time — a phone on a kitchen table can be read '
                          'by anyone in the room.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      for (final notification in notifications)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: _NotificationTile(
                            notification: notification,
                            now: now,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

class _NotificationTile extends ConsumerWidget {
  const _NotificationTile({required this.notification, required this.now});

  final AppNotification notification;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final unread = !notification.isRead;
    final ink = notification.kind.isUrgent ? context.cautionInk : context.infoInk;

    return AppCard(
      borderColor: unread ? theme.colorScheme.primary : null,
      semanticLabel: '${unread ? 'Unread. ' : ''}${notification.title}. '
          '${notification.body}',
      onTap: () {
        // Navigation does not wait on the read receipt. Opening the update is
        // what the user asked for; marking it read is bookkeeping, and the
        // snapshot that comes back updates the badge a moment later.
        unawaited(
          ref
              .read(careProvider.notifier)
              .markNotificationRead(notification.id),
        );
        final rideId = notification.rideId;
        final appointmentId = notification.appointmentId;
        if (rideId != null) {
          context.push('/rides/$rideId');
        } else if (appointmentId != null) {
          context.push('/appointments/$appointmentId');
        }
      },
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              color: context.containerFor(ink),
              borderRadius: AppRadius.controlAll,
            ),
            child: Icon(_iconFor(notification.kind), color: ink, size: 22),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        notification.title,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontWeight:
                              unread ? FontWeight.w700 : FontWeight.w500,
                        ),
                      ),
                    ),
                    if (unread)
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  notification.body,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  formatFreshness(now.difference(notification.createdAt)),
                  style: theme.textTheme.bodySmall?.copyWith(
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

  IconData _iconFor(NotificationKind kind) => switch (kind) {
        NotificationKind.appointmentCreated ||
        NotificationKind.appointmentChanged =>
          Icons.event_outlined,
        NotificationKind.appointmentReminder => Icons.alarm,
        NotificationKind.appointmentCanceled => Icons.event_busy_outlined,
        NotificationKind.rideRequested => Icons.hourglass_empty,
        NotificationKind.driverAssigned => Icons.person_pin_circle_outlined,
        NotificationKind.driverEnRoute => Icons.directions_car_outlined,
        NotificationKind.driverArrivingSoon => Icons.timer_outlined,
        NotificationKind.driverArrived => Icons.pin_drop_outlined,
        NotificationKind.patientPickedUp => Icons.event_seat_outlined,
        NotificationKind.patientArrived => Icons.local_hospital_outlined,
        NotificationKind.rideDelayed => Icons.watch_later_outlined,
        NotificationKind.rideCompleted => Icons.task_alt,
        NotificationKind.rideCanceled => Icons.cancel_outlined,
        NotificationKind.accessGranted => Icons.group_add_outlined,
      };
}
