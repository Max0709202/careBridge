import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The landing screen for an invitation link.
///
/// It exists as a screen rather than a silent redirect because acceptance can
/// fail for a reason the person needs to understand and can act on: the link
/// is bound to one email address, and it only works once that address has been
/// confirmed. "Nothing happened" would be the worst possible response to a
/// link somebody was told to click.
class AcceptInvitationScreen extends ConsumerStatefulWidget {
  const AcceptInvitationScreen({super.key, required this.token});

  final String token;

  @override
  ConsumerState<AcceptInvitationScreen> createState() =>
      _AcceptInvitationScreenState();
}

class _AcceptInvitationScreenState
    extends ConsumerState<AcceptInvitationScreen> {
  bool _busy = false;
  Object? _error;
  bool _accepted = false;

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(careProvider.notifier).acceptInvitation(widget.token);
      if (mounted) setState(() => _accepted = true);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(careProvider).user;

    return Scaffold(
      appBar: AppBar(title: const Text('Invitation')),
      body: ListView(
        children: [
          ScreenBody(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_accepted)
                  AppCard(
                    child: EmptyState(
                      icon: Icons.how_to_reg,
                      title: 'You are in',
                      message:
                          'You can now see this person’s appointments and '
                          'follow their rides.',
                      action: FilledButton(
                        onPressed: () => context.go('/'),
                        child: const Text('Go to the dashboard'),
                      ),
                    ),
                  )
                else ...[
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Join a care circle',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          'Accepting gives you access to someone’s '
                          'appointments, their home address, and where they '
                          'are during a ride. Only accept an invitation you '
                          'were expecting.',
                          style: theme.textTheme.bodyMedium,
                        ),
                        if (user != null) ...[
                          const SizedBox(height: AppSpacing.md),
                          InfoRow(label: 'Signed in as', value: user.email),
                          if (!user.isEmailVerified)
                            Padding(
                              padding: const EdgeInsets.only(
                                top: AppSpacing.sm,
                              ),
                              child: Text(
                                'Confirm this address first — an invitation '
                                'only works for an address its owner has '
                                'proved they hold.',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.error,
                                ),
                              ),
                            ),
                        ],
                      ],
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    AppCard(
                      child: Row(
                        children: [
                          Icon(
                            Icons.error_outline,
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(child: Text(failureMessage(_error!))),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: _busy ? null : _accept,
                    child: Text(_busy ? 'Joining…' : 'Accept the invitation'),
                  ),
                  TextButton(
                    onPressed: () => context.go('/'),
                    child: const Text('Not now'),
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
