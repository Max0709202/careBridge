import 'package:carebridge_api/carebridge_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Two-factor enrolment.
///
/// The flow is enrol → confirm, in that order and never collapsed, because
/// marking two-factor active the moment the secret is displayed locks out
/// anyone whose authenticator failed to accept it — with no second factor left
/// to recover with, by definition. The screen says so, because a user who does
/// not understand why there is a second step will abandon it at the first.
class TwoFactorScreen extends ConsumerStatefulWidget {
  const TwoFactorScreen({super.key});

  @override
  ConsumerState<TwoFactorScreen> createState() => _TwoFactorScreenState();
}

class _TwoFactorScreenState extends ConsumerState<TwoFactorScreen> {
  MfaStatusDto? _status;
  MfaEnrolmentDto? _enrolment;
  final _code = TextEditingController();
  bool _busy = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final status = await ref.read(careApiProvider).mfaStatus();
      if (mounted) setState(() => _status = status);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _begin() async {
    setState(() => _busy = true);
    try {
      final enrolment = await ref.read(careApiProvider).beginMfaEnrolment();
      if (mounted) setState(() => _enrolment = enrolment);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).confirmMfa(_code.text.trim());
      _code.clear();
      if (mounted) setState(() => _enrolment = null);
      await _load();
      if (mounted) {
        showConfirmationBanner(context, 'Two-factor authentication is on.');
      }
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disable() async {
    final confirmed = await confirmAction(
      context,
      title: 'Turn off two-factor authentication?',
      message:
          'Signing in will only need your password again. Anyone who learns it '
          'can see this patient’s address and where they are during a ride.',
      confirmLabel: 'Turn it off',
      cancelLabel: 'Keep it on',
    );
    if (!confirmed) return;

    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).disableMfa();
      await _load();
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Two-factor authentication')),
      body: ListView(children: [ScreenBody(child: _body(Theme.of(context)))]),
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

    final enrolment = _enrolment;
    if (enrolment != null) return _confirmStep(theme, enrolment);

    final status = _status;
    if (status == null) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.xl),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    return status.enrolled ? _onState(theme, status) : _offState(theme);
  }

  Widget _offState(ThemeData theme) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Off', style: theme.textTheme.titleMedium),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'With two-factor authentication on, signing in needs your '
              'password and a six-digit code from an app on your phone. '
              'Someone who learns your password still cannot get in.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.md),
            FilledButton.icon(
              onPressed: _busy ? null : _begin,
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Set it up'),
            ),
          ],
        ),
      ),
    ],
  );

  Widget _onState(ThemeData theme, MfaStatusDto status) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_user, color: theme.colorScheme.primary),
                const SizedBox(width: AppSpacing.sm),
                Text('On', style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              '${status.recoveryCodesRemaining} recovery codes left. Each '
              'one works once, and they are the only way in if you lose '
              'your phone.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton.icon(
              onPressed: _busy ? null : _disable,
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Turn off'),
            ),
          ],
        ),
      ),
    ],
  );

  Widget _confirmStep(ThemeData theme, MfaEnrolmentDto enrolment) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const SectionHeader('1 · Add it to your authenticator app'),
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Type this key into an authenticator app — Google '
              'Authenticator, 1Password, or whatever you already use.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.md),
            SelectableText(
              _grouped(enrolment.secretBase32),
              style: theme.textTheme.titleMedium?.copyWith(
                fontFamily: 'monospace',
                letterSpacing: 1.5,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(
                  ClipboardData(text: enrolment.secretBase32),
                );
                if (mounted) {
                  showConfirmationBanner(context, 'Key copied.');
                }
              },
              icon: const Icon(Icons.copy_all_outlined),
              label: const Text('Copy the key'),
            ),
          ],
        ),
      ),

      const SizedBox(height: AppSpacing.lg),
      const SectionHeader('2 · Save your recovery codes'),
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Shown once, and never again — not even to support. Put them '
              'somewhere that is not your phone.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.md),
            SelectableText(
              enrolment.recoveryCodes.join('\n'),
              style: theme.textTheme.bodyLarge?.copyWith(
                fontFamily: 'monospace',
              ),
            ),
          ],
        ),
      ),

      const SizedBox(height: AppSpacing.lg),
      const SectionHeader('3 · Confirm it works'),
      AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Nothing changes until a code from your app is accepted. '
              'That is deliberate — turning it on before checking would '
              'lock you out if the app did not take the key.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: const InputDecoration(
                labelText: 'Six-digit code',
                counterText: '',
              ),
              onSubmitted: (_) => _busy ? null : _confirm(),
            ),
            const SizedBox(height: AppSpacing.md),
            FilledButton(
              onPressed: _busy ? null : _confirm,
              child: Text(_busy ? 'Checking…' : 'Turn on two-factor'),
            ),
            TextButton(
              onPressed: _busy ? null : () => setState(() => _enrolment = null),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    ],
  );
}

/// Grouped in fours because it is transcribed by hand, often onto paper.
String _grouped(String secret) {
  final buffer = StringBuffer();
  for (var i = 0; i < secret.length; i += 4) {
    if (i > 0) buffer.write(' ');
    buffer.write(secret.substring(i, (i + 4).clamp(0, secret.length)));
  }
  return buffer.toString();
}
