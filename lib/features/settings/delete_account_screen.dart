import 'dart:convert';

import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The way out.
///
/// Apple 5.1.1(v) requires that an app which can create an account can delete
/// one *from inside the app*, and is explicit that a support email address does
/// not count. But the reason this screen is written the way it is has less to
/// do with the rule than with who reaches it: in this product, the most common
/// reason somebody deletes their account is that the person they were
/// coordinating care for has died. So it explains rather than warns, it says
/// plainly what will and will not be destroyed, and it makes the undo obvious
/// before asking for the confirmation rather than after.
///
/// Three states: the explanation, a refusal with its remedy, and — once it is
/// scheduled — the export, which is the last thing this session can hand over.
///
/// There is deliberately no "already scheduled" state. Requesting a deletion
/// signs every device out and signing back in cancels it, so no session can
/// exist in which one is pending; the date is shown once, here, in the
/// response to the request, and again in the email.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  wire.DeletionStatusDto? _status;
  Object? _error;
  bool _busy = false;

  /// Set once the deletion is scheduled. While it is non-null this session is
  /// already signed out server-side, so the only thing left to do here is hand
  /// over the data.
  Map<String, dynamic>? _exported;
  DateTime? _scheduledFor;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final status = await ref.read(careApiProvider).deletionStatus();
      if (mounted) setState(() => _status = status);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _delete() async {
    final status = _status;
    if (status == null) return;

    final confirmed = await confirmAction(
      context,
      title: 'Delete your account?',
      message:
          'Every device is signed out now. The account itself is deleted in '
          '${status.graceDays} days — and signing in again before then cancels '
          'it.\n\n'
          'Invoices and payment records are kept for as long as the law '
          'requires, with nothing left on them that identifies you.',
      confirmLabel: 'Delete my account',
      cancelLabel: 'Keep my account',
      destructive: true,
    );
    if (!confirmed) return;

    setState(() => _busy = true);
    try {
      final receipt = await ref.read(careApiProvider).deleteAccount();
      if (!mounted) return;
      setState(() {
        _exported = receipt.data;
        _scheduledFor = receipt.scheduledFor;
      });
    } catch (error) {
      if (mounted) {
        showFailure(context, error);
        // A refusal is a state, not a transient error: reload so the blockers
        // that caused it are on screen with their remedies.
        await _load();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _copyExport() async {
    final data = _exported;
    if (data == null) return;

    await Clipboard.setData(
      ClipboardData(text: const JsonEncoder.withIndent('  ').convert(data)),
    );
    if (mounted) {
      showConfirmationBanner(context, 'Your data was copied to the clipboard.');
    }
  }

  /// Leaves for the sign-in screen.
  ///
  /// `forgetSession` rather than a sign-out call: the tokens are already
  /// cleared and the server already raised the token version, so there is no
  /// session left to end — only local state to drop.
  void _finish() {
    ref.read(careProvider.notifier).forgetSession();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Delete account'),
        // Once it is scheduled, going back lands on a screen whose session is
        // already dead. The only way on is forwards.
        automaticallyImplyLeading: _exported == null,
      ),
      body: SafeArea(
        child: ListView(
          children: [
            ScreenBody(
              child: _exported != null ? _scheduled(context) : _offer(context),
            ),
          ],
        ),
      ),
    );
  }

  // ─── before ────────────────────────────────────────────────────────────────

  Widget _offer(BuildContext context) {
    final theme = Theme.of(context);
    final status = _status;

    if (_error != null) {
      return AppCard(
        child: EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load your account',
          message: 'Check your connection and try again.',
          action: OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ),
      );
    }

    if (status == null) {
      return const AppCard(
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: CircularProgressIndicator(),
          ),
        ),
      );
    }

    final blocked = status.blockerMessages.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('What happens'),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _bullet(
                theme,
                Icons.logout,
                'Every device is signed out straight away.',
              ),
              _bullet(
                theme,
                Icons.schedule,
                'The account is deleted ${status.graceDays} days from now. '
                'Signing in again before then cancels it — that is all it '
                'takes.',
              ),
              _bullet(
                theme,
                Icons.person_off_outlined,
                'Your name, address, phone number, sign-in details and '
                'notification history are removed.',
              ),
              _bullet(
                theme,
                Icons.download_outlined,
                'You get a copy of everything we hold, on this screen, before '
                'you go.',
              ),
            ],
          ),
        ),

        const SizedBox(height: AppSpacing.lg),
        const SectionHeader('What is kept'),
        AppCard(
          child: Text(
            'Invoices, payments and the log of actions taken on the account '
            'are kept for as long as financial and audit rules require — with '
            'nothing left on them that identifies you.\n\n'
            'We would rather tell you that now than have you find an invoice '
            'with your name on it later.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),

        if (blocked) ...[
          const SizedBox(height: AppSpacing.lg),
          const SectionHeader('Not just yet'),
          for (final message in status.blockerMessages)
            AppCard(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.pause_circle_outline,
                    color: theme.colorScheme.error,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(message, style: theme.textTheme.bodyMedium),
                  ),
                ],
              ),
            ),
        ],

        const SizedBox(height: AppSpacing.lg),
        FilledButton.icon(
          // Refusals are decided on the server; disabling here only keeps the
          // person from tapping into an error they can already read above.
          onPressed: _busy || blocked ? null : _delete,
          style: FilledButton.styleFrom(
            backgroundColor: theme.colorScheme.error,
            foregroundColor: theme.colorScheme.onError,
          ),
          icon: const Icon(Icons.delete_forever_outlined),
          label: Text(_busy ? 'Deleting…' : 'Delete my account'),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'You can also do this from our website without the app.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  // ─── after ─────────────────────────────────────────────────────────────────

  Widget _scheduled(BuildContext context) {
    final theme = Theme.of(context);
    final when = _scheduledFor;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(
                Icons.check_circle_outline,
                size: 40,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Your account is scheduled for deletion',
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                when == null
                    ? 'Every device has been signed out.'
                    : 'It will be deleted on '
                          '${DateFormat.yMMMMd().format(when.toLocal())}. '
                          'Every device has been signed out. If you change '
                          'your mind, sign in again before then — that '
                          'cancels it.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),

        const SizedBox(height: AppSpacing.lg),
        const SectionHeader('Your data'),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'This is everything we hold about the account, as it was when '
                'you asked. Take it now if you want it — signing back in to '
                'fetch it would cancel the deletion.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              FilledButton.tonalIcon(
                onPressed: _copyExport,
                icon: const Icon(Icons.copy_all_outlined),
                label: const Text('Copy my data'),
              ),
              const SizedBox(height: AppSpacing.md),
              Container(
                constraints: const BoxConstraints(maxHeight: 220),
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SingleChildScrollView(
                  child: SelectableText(
                    const JsonEncoder.withIndent('  ').convert(_exported),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: AppSpacing.lg),
        FilledButton(onPressed: _finish, child: const Text('Done')),
      ],
    );
  }

  Widget _bullet(ThemeData theme, IconData icon, String text) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: AppSpacing.sm),
        Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
      ],
    ),
  );
}
