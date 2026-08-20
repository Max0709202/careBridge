import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Which operator this session is dispatching for.
///
/// Always a choice, never a default — even when there is only one. Somebody
/// who dispatches for two companies looking at the wrong queue sees an empty
/// list, and an empty list reads as "no work" rather than "wrong screen". The
/// cost of one extra tap at the start of a shift is far below the cost of that
/// misreading once.
class OrganizationPickerScreen extends ConsumerWidget {
  const OrganizationPickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organizations = ref.watch(organizationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Choose an operator'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: organizations.when(
            loading: () => const LoadingBlock(),
            error: (error, _) => EmptyState(
              icon: Icons.cloud_off_outlined,
              title: 'Could not load your operators',
              message: 'Check your connection and try again.',
              action: OutlinedButton(
                onPressed: () => ref.invalidate(organizationsProvider),
                child: const Text('Retry'),
              ),
            ),
            data: (list) {
              // A real and unhelpful state without an explanation: an account
              // that exists but holds no membership. Telling them to ask an
              // administrator is the only actionable thing there is, and it
              // beats an empty screen that looks broken.
              if (list.isEmpty) {
                return const EmptyState(
                  icon: Icons.business_outlined,
                  title: 'No operators yet',
                  message:
                      'This account is not a member of any transport operator. '
                      'Ask an owner or administrator to add you.',
                );
              }

              return ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.all(AppSpacing.lg),
                itemCount: list.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(height: AppSpacing.sm),
                itemBuilder: (context, index) {
                  final organization = list[index];

                  return OpsCard(
                    onTap: organization.canDispatch
                        ? () => ref
                              .read(selectedOrganizationIdProvider.notifier)
                              .select(organization.id)
                        : null,
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                organization.name,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              Text(
                                organization.role,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              // A `member` can hold a membership without being
                              // able to dispatch. Said plainly rather than
                              // shown as a row that silently does nothing.
                              if (!organization.canDispatch)
                                Padding(
                                  padding: const EdgeInsets.only(
                                    top: AppSpacing.xs,
                                  ),
                                  child: Text(
                                    'This role cannot use the dispatch console.',
                                    style: Theme.of(context).textTheme.bodySmall
                                        ?.copyWith(
                                          color: Theme.of(
                                            context,
                                          ).colorScheme.error,
                                        ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (organization.canDispatch)
                          const Icon(Icons.chevron_right),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }
}
