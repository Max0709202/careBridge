import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/verification_banner.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final theme = Theme.of(context);
    final user = state.user;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ScreenBody(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const VerificationBanner(),
                if (user != null)
                  AppCard(
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 26,
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(
                            user.initials,
                            style: theme.textTheme.titleMedium?.copyWith(
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
                                user.fullName,
                                style: theme.textTheme.titleMedium,
                              ),
                              Text(
                                user.email,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('Reading and accessibility'),
                AppCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.xs,
                  ),
                  child: SwitchListTile(
                    value: state.simplifiedMode,
                    onChanged: (value) async {
                      try {
                        await ref
                            .read(careProvider.notifier)
                            .setSimplifiedMode(value);
                      } catch (error) {
                        if (context.mounted) showFailure(context, error);
                      }
                    },
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Simplified mode'),
                    subtitle: const Text(
                      'Larger text throughout. Intended for the person being '
                      'cared for when they hold the phone themselves — or for '
                      'anyone who prefers it.',
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'CareBridge also follows your device’s text size and contrast '
                  'settings.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('People you care for'),
                for (final patient in state.activePatients)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: AppCard(
                      onTap: () => context.push('/patients/${patient.id}'),
                      child: Row(
                        children: [
                          CircleAvatar(child: Text(patient.firstInitial)),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  patient.preferredName,
                                  style: theme.textTheme.bodyLarge,
                                ),
                                Text(
                                  patient.homeAddress.shortLine,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right),
                        ],
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: () => context.push('/patients/new'),
                  icon: const Icon(Icons.person_add_alt_1_outlined),
                  label: const Text('Add someone'),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('Your account'),
                AppCard(
                  padding: const EdgeInsets.symmetric(
                    vertical: AppSpacing.xs,
                  ),
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.security_outlined),
                        title: const Text('Account security'),
                        subtitle: const Text(
                          'Where you are signed in, and your password',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/settings/security'),
                      ),
                      ListTile(
                        leading: const Icon(Icons.notifications_outlined),
                        title: const Text('Notifications'),
                        subtitle: const Text(
                          'Which events reach you by email and push',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/settings/notifications'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('Not built yet'),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'These need the server, and are listed here rather than '
                        'shown as controls that do nothing.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      for (final item in const [
                        'Payment methods and receipts',
                        'Family plan subscription',
                        'Inviting other relatives',
                        'Notification channel preferences',
                        'Push notifications',
                        'Downloading your data',
                      ])
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Icon(
                                Icons.schedule,
                                size: 18,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Text(item, style: theme.textTheme.bodyMedium),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Safety', style: theme.textTheme.titleMedium),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'CareBridge coordinates appointments and transport. It '
                        'is not a medical service and not an emergency service. '
                        'In an emergency, call 911.',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                OutlinedButton.icon(
                  onPressed: () async {
                    final confirmed = await confirmAction(
                      context,
                      title: 'Sign out?',
                      message: 'You will need to sign in again to see '
                          'appointments and trips.',
                      confirmLabel: 'Sign out',
                      cancelLabel: 'Stay signed in',
                      destructive: false,
                    );
                    if (!confirmed || !context.mounted) return;
                    // `signOut` swallows a server failure and clears the local
                    // session regardless, so this cannot leave the user stuck
                    // on a signed-in screen with no way out.
                    await ref.read(careProvider.notifier).signOut();
                    if (context.mounted) context.go('/sign-in');
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
                const SizedBox(height: AppSpacing.xl),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
