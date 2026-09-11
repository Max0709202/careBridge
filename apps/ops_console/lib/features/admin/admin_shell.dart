import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';

/// The frame the administration screens sit in.
///
/// A **separate** shell from `ConsoleShell`, and the separation is the point
/// rather than a routing convenience. Every operational screen is scoped to
/// one operator by an organisation id in the path; nothing here is. An
/// operator's owner has complete authority over their own company and none at
/// all over anybody else's, while platform support has a narrow read-only view
/// across all of them — two different axes, and a shared frame would quietly
/// suggest they are the same one.
///
/// It also means a platform account with no operator membership has somewhere
/// to be. Before this existed the console had exactly one entry point, the
/// operator picker, and an account holding no membership arrived at "no
/// operators yet" with nowhere to go.
class AdminShell extends ConsumerWidget {
  const AdminShell({super.key, required this.child});

  final Widget child;

  static const _destinations = [
    (path: '/admin', icon: Icons.dashboard_outlined, label: 'Overview'),
    (path: '/admin/audit', icon: Icons.receipt_long_outlined, label: 'Audit'),
    (path: '/admin/flags', icon: Icons.toggle_on_outlined, label: 'Flags'),
    (path: '/admin/refunds', icon: Icons.undo_outlined, label: 'Refunds'),
  ];

  /// Matched from the most specific path backwards.
  ///
  /// `/admin` is a prefix of every other entry, so a forward scan would select
  /// Overview for all four and the rail would never move off the first item.
  int _indexFor(String location) {
    for (var i = _destinations.length - 1; i > 0; i--) {
      if (location.startsWith(_destinations[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final index = _indexFor(location);
    final wide = MediaQuery.sizeOf(context).width >= AppSpacing.wideBreakpoint;
    final hasOperator = ref.watch(selectedOrganizationIdProvider) != null;

    void go(int next) => context.go(_destinations[next].path);

    return Scaffold(
      appBar: AppBar(
        // Named rather than left as "CareBridge ops". Somebody who administers
        // both surfaces must never have to infer from the contents which one
        // they are acting in — an action taken here reaches every operator.
        title: const Text('CareBridge administration'),
        actions: [
          IconButton(
            tooltip: hasOperator ? 'Back to dispatch' : 'Choose an operator',
            icon: const Icon(Icons.arrow_back),
            onPressed: () =>
                context.go(hasOperator ? '/queue' : '/organizations'),
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
          ),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: index,
                  onDestinationSelected: go,
                  labelType: NavigationRailLabelType.all,
                  destinations: [
                    for (final destination in _destinations)
                      NavigationRailDestination(
                        icon: Icon(destination.icon),
                        label: Text(destination.label),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: child),
              ],
            )
          : child,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: go,
              destinations: [
                for (final destination in _destinations)
                  NavigationDestination(
                    icon: Icon(destination.icon),
                    label: destination.label,
                  ),
              ],
            ),
    );
  }
}
