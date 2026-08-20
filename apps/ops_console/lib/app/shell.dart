import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../state/providers.dart';
import 'theme.dart';

/// The frame every operational screen sits in.
///
/// A rail on a wide screen and a bottom bar on a narrow one. Not a drawer: a
/// dispatcher moves between the queue and the roster constantly — putting a
/// driver on shift is usually a *response* to an empty candidate list — and a
/// navigation surface that has to be opened first adds a gesture to the loop
/// that runs most often.
class ConsoleShell extends ConsumerWidget {
  const ConsoleShell({super.key, required this.child});

  final Widget child;

  static const _destinations = [
    (path: '/queue', icon: Icons.list_alt_outlined, label: 'Queue'),
    (path: '/roster', icon: Icons.people_outline, label: 'Roster'),
    (path: '/fleet', icon: Icons.directions_car_outlined, label: 'Fleet'),
    (path: '/seats', icon: Icons.receipt_long_outlined, label: 'Seats'),
  ];

  int _indexFor(String location) {
    for (var i = 0; i < _destinations.length; i++) {
      if (location.startsWith(_destinations[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organization = ref.watch(selectedOrganizationProvider);
    final location = GoRouterState.of(context).matchedLocation;
    final index = _indexFor(location);
    final wide = MediaQuery.sizeOf(context).width >= AppSpacing.wideBreakpoint;

    void go(int next) => context.go(_destinations[next].path);

    return Scaffold(
      appBar: AppBar(
        title: Text(organization?.name ?? 'CareBridge ops'),
        // The operator is named in the title bar at all times, not only on the
        // picker. Somebody dispatching for two companies must never have to
        // infer which queue they are looking at from its contents.
        actions: [
          if (organization != null)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: Center(
                child: Text(
                  organization.role,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
          IconButton(
            tooltip: 'Switch operator',
            icon: const Icon(Icons.swap_horiz),
            onPressed: () => context.go('/organizations'),
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
