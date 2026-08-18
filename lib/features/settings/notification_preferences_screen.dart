import 'package:carebridge_api/carebridge_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Per-event, per-channel notification settings.
///
/// The whole matrix comes from the server rather than being assembled here. If
/// the client held its own copy of the defaults, the two would drift the first
/// time an event kind was added — and the symptom would be a switch that shows
/// "off" while the server is happily sending.
///
/// In-app is rendered as a fixed row rather than a disabled switch. It is not
/// a setting someone is being denied; it is the record of what happened, and a
/// timeline a user could switch off would lie by omission.
class NotificationPreferencesScreen extends ConsumerStatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  ConsumerState<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends ConsumerState<NotificationPreferencesScreen> {
  List<NotificationPreferenceDto>? _rows;
  Object? _error;
  final _pending = <String>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final rows = await ref.read(careApiProvider).notificationPreferences();
      if (mounted) setState(() => _rows = rows);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _set(NotificationPreferenceDto row, bool enabled) async {
    final key = '${row.kind.wireName}:${row.channel.wireName}';
    setState(() => _pending.add(key));
    try {
      final updated = await ref
          .read(careApiProvider)
          .setNotificationPreference(
            kind: row.kind.wireName,
            channel: row.channel.wireName,
            enabled: enabled,
          );
      if (mounted) setState(() => _rows = updated);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _pending.remove(key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [ScreenBody(child: _body(theme))]),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_error != null) {
      return AppCard(
        child: EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load your settings',
          message: 'Check your connection and try again.',
          action: OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ),
      );
    }

    final rows = _rows;
    if (rows == null) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    // Grouped by kind, in the order the server sent them.
    final byKind = <NotificationKind, List<NotificationPreferenceDto>>{};
    for (final row in rows) {
      byKind.putIfAbsent(row.kind, () => []).add(row);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppCard(
          child: Text(
            'Emails and push messages never say who the appointment is for, '
            'which clinic it is at, or when. They say something changed and '
            'ask you to open the app — a phone on a kitchen table is readable '
            'by whoever is in the room.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        for (final entry in byKind.entries) ...[
          const SizedBox(height: AppSpacing.md),
          SectionHeader(_label(entry.key)),
          AppCard(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
            child: Column(
              children: [
                for (final row in entry.value) _channelRow(theme, row),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _channelRow(ThemeData theme, NotificationPreferenceDto row) {
    final channel = _channelLabel(row.channel);

    if (!row.configurable) {
      return ListTile(
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        leading: Icon(Icons.inbox_outlined, color: theme.colorScheme.primary),
        title: Text(channel),
        subtitle: const Text(
          'Always on — this is your record of what happened',
        ),
      );
    }

    final key = '${row.kind.wireName}:${row.channel.wireName}';

    return SwitchListTile(
      value: row.enabled,
      onChanged: _pending.contains(key) ? null : (value) => _set(row, value),
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      secondary: Icon(
        row.channel == NotificationChannel.email
            ? Icons.mail_outline
            : Icons.notifications_outlined,
      ),
      title: Text(channel),
    );
  }
}

String _channelLabel(NotificationChannel channel) => switch (channel) {
  NotificationChannel.inApp => 'In the app',
  NotificationChannel.email => 'Email',
  NotificationChannel.push => 'Push',
};

/// Plain language for each event. The wire names are for the API, not for a
/// person reading a settings screen at eleven at night.
String _label(NotificationKind kind) => switch (kind) {
  NotificationKind.appointmentCreated => 'An appointment is added',
  NotificationKind.appointmentReminder => 'An appointment is coming up',
  NotificationKind.appointmentChanged => 'An appointment changes',
  NotificationKind.appointmentCanceled => 'An appointment is cancelled',
  NotificationKind.rideRequested => 'Transport is requested',
  NotificationKind.driverAssigned => 'A driver is assigned',
  NotificationKind.driverEnRoute => 'The driver sets off',
  NotificationKind.driverArrivingSoon => 'The driver is arriving soon',
  NotificationKind.driverArrived => 'The driver arrives',
  NotificationKind.patientPickedUp => 'The passenger is picked up',
  NotificationKind.patientArrived => 'The passenger arrives',
  NotificationKind.rideDelayed => 'A ride is delayed',
  NotificationKind.rideCompleted => 'A ride is finished',
  NotificationKind.rideCanceled => 'A ride is cancelled',
  NotificationKind.accessGranted => 'Someone joins the care circle',
};
