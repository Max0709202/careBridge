import 'package:carebridge_api/carebridge_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Sessions, password, and the way out of a device you no longer hold.
///
/// The session list is the point of this screen. It answers "is anyone else
/// signed in as me?" — which is a question a family member asks about an
/// account that can see a vulnerable person's address and daily movements, and
/// which nothing else in the app can answer.
class AccountSecurityScreen extends ConsumerStatefulWidget {
  const AccountSecurityScreen({super.key});

  @override
  ConsumerState<AccountSecurityScreen> createState() =>
      _AccountSecurityScreenState();
}

class _AccountSecurityScreenState extends ConsumerState<AccountSecurityScreen> {
  List<SessionSummaryDto>? _sessions;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final sessions = await ref.read(careApiProvider).sessions();
      if (mounted) setState(() => _sessions = sessions);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _revoke(SessionSummaryDto session) async {
    final confirmed = await confirmAction(
      context,
      title: 'Sign out ${session.deviceLabel}?',
      message:
          'That device will have to sign in again. Anything it is doing right '
          'now stops.',
      confirmLabel: 'Sign it out',
      cancelLabel: 'Cancel',
    );
    if (!confirmed) return;

    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).revokeSession(session.id);
      await _load();
      if (mounted) showConfirmationBanner(context, 'That device was signed out.');
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOutEverywhere() async {
    final confirmed = await confirmAction(
      context,
      title: 'Sign out everywhere?',
      message:
          'Every device, including this one, is signed out immediately — not '
          'when its session happens to expire.',
      confirmLabel: 'Sign out everywhere',
      cancelLabel: 'Cancel',
      destructive: true,
    );
    if (!confirmed) return;

    try {
      await ref.read(careApiProvider).signOutEverywhere();
      ref.read(careProvider.notifier).forgetSession();
    } catch (error) {
      if (mounted) showFailure(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Account security')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            ScreenBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SectionHeader('Where you are signed in'),
                  _sessionList(theme),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionHeader('Password'),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Changing your password signs out every device, '
                          'including this one, and emails you to say it '
                          'happened.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        OutlinedButton.icon(
                          onPressed: () => _changePassword(context),
                          icon: const Icon(Icons.key_outlined),
                          label: const Text('Change password'),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionHeader('Two-factor authentication'),
                  AppCard(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.xs,
                    ),
                    child: ListTile(
                      leading: const Icon(Icons.shield_outlined),
                      title: const Text('Two-factor authentication'),
                      subtitle: const Text(
                        'A code from your phone, as well as your password',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.push('/settings/security/two-factor'),
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionHeader('Everywhere'),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'If you have lost a phone, this is the fastest thing '
                          'to do. It takes effect on the next request each '
                          'device makes, not at the end of its session.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        FilledButton.tonalIcon(
                          onPressed: _busy ? null : _signOutEverywhere,
                          icon: const Icon(Icons.logout),
                          label: const Text('Sign out everywhere'),
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
    );
  }

  Widget _sessionList(ThemeData theme) {
    if (_error != null) {
      return AppCard(
        child: EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load your sessions',
          message: 'Check your connection and try again.',
          action: OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ),
      );
    }

    final sessions = _sessions;
    if (sessions == null) {
      return const AppCard(
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: CircularProgressIndicator(),
          ),
        ),
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Column(
        children: [
          for (final session in sessions)
            ListTile(
              leading: Icon(
                _iconFor(session.deviceLabel),
                color: session.isCurrent ? theme.colorScheme.primary : null,
              ),
              title: Text(session.deviceLabel),
              subtitle: Text(
                session.isCurrent
                    ? 'This device'
                    : 'Last used ${_relative(session.lastUsedAt)}',
              ),
              trailing: session.isCurrent
                  ? Chip(
                      label: const Text('Current'),
                      visualDensity: VisualDensity.compact,
                      backgroundColor: theme.colorScheme.primaryContainer,
                    )
                  : IconButton(
                      onPressed: _busy ? null : () => _revoke(session),
                      icon: const Icon(Icons.logout),
                      tooltip: 'Sign out ${session.deviceLabel}',
                    ),
            ),
        ],
      ),
    );
  }

  Future<void> _changePassword(BuildContext context) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ChangePasswordSheet(),
    );

    if (changed == true && mounted) {
      // The server revoked every session, this one included, so there is
      // nothing left to show on this screen.
      ref.read(careProvider.notifier).forgetSession();
    }
  }
}

IconData _iconFor(String label) {
  if (label.contains('iPhone')) return Icons.phone_iphone;
  if (label.contains('Android')) return Icons.phone_android;
  if (label.contains('Mac') || label.contains('Windows')) {
    return Icons.laptop_outlined;
  }
  return Icons.devices_other_outlined;
}

/// Coarse on purpose: "3 hours ago" is what a person checks a session list for.
///
/// The parameter is a `DateTime` rather than a string because the generated
/// DTO already parsed it — which is the generated client earning its place.
String _relative(DateTime instant) {
  final at = instant.toLocal();
  final elapsed = DateTime.now().difference(at);
  if (elapsed.inMinutes < 2) return 'just now';
  if (elapsed.inMinutes < 60) return '${elapsed.inMinutes} minutes ago';
  if (elapsed.inHours < 24) return '${elapsed.inHours} hours ago';
  if (elapsed.inDays < 7) return '${elapsed.inDays} days ago';
  return 'on ${DateFormat.yMMMd().format(at)}';
}

class _ChangePasswordSheet extends ConsumerStatefulWidget {
  const _ChangePasswordSheet();

  @override
  ConsumerState<_ChangePasswordSheet> createState() =>
      _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends ConsumerState<_ChangePasswordSheet> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).changePassword(
            currentPassword: _current.text,
            newPassword: _next.text,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.lg,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
      ),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Change your password',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _current,
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              decoration: const InputDecoration(
                labelText: 'Current password',
              ),
              validator: (value) =>
                  (value ?? '').isEmpty ? 'Enter your current password.' : null,
            ),
            const SizedBox(height: AppSpacing.md),
            TextFormField(
              controller: _next,
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              decoration: const InputDecoration(
                labelText: 'New password',
                // Length is the requirement, not symbol classes — and the hint
                // matches the server's rule exactly, so the form never accepts
                // something the server then rejects.
                helperText: 'At least 10 characters. A phrase works well.',
              ),
              validator: (value) => (value ?? '').length < 10
                  ? 'Use at least 10 characters.'
                  : null,
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Changing…' : 'Change password'),
            ),
          ],
        ),
      ),
    );
  }
}
