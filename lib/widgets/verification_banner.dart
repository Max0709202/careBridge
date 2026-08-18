import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/theme.dart';
import '../state/providers.dart';
import 'common.dart';

/// Asks the user to confirm their email address, once it matters.
///
/// Registration deliberately does **not** block on verification — locking a
/// family out of a ride they have already booked because an email went to spam
/// is the worse outcome. But an unverified address cannot issue or accept an
/// invitation, so without a prompt a user hits that wall with no explanation.
/// This is the prompt, and it is the only reason an unverified address ever
/// becomes a verified one.
///
/// It renders nothing at all when there is nothing to say, so it is safe to
/// place at the top of any screen.
class VerificationBanner extends ConsumerStatefulWidget {
  const VerificationBanner({super.key});

  @override
  ConsumerState<VerificationBanner> createState() => _VerificationBannerState();
}

class _VerificationBannerState extends ConsumerState<VerificationBanner> {
  bool _sending = false;
  bool _sent = false;

  Future<void> _resend(String email) async {
    setState(() => _sending = true);
    try {
      await ref.read(careApiProvider).resendVerification(email);
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(careProvider).user;
    if (user == null || user.isEmailVerified) return const SizedBox.shrink();

    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: AppCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              _sent
                  ? Icons.mark_email_read_outlined
                  : Icons.mark_email_unread_outlined,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _sent ? 'Check your inbox' : 'Confirm your email address',
                    style: theme.textTheme.titleSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _sent
                        ? 'We sent a new link to ${user.email}. It works once '
                              'and expires in a day.'
                        : 'You can use CareBridge without it, but you cannot '
                              'invite a relative or accept an invitation until '
                              'the address is confirmed.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (!_sent) ...[
                    const SizedBox(height: AppSpacing.sm),
                    TextButton(
                      onPressed: _sending ? null : () => _resend(user.email),
                      child: Text(
                        _sending ? 'Sending…' : 'Send the link again',
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
