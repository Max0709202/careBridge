import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/sign_in_screen.dart';
import '../features/fleet/fleet_screen.dart';
import '../features/organizations/organization_picker_screen.dart';
import '../features/queue/queue_screen.dart';
import '../features/roster/roster_screen.dart';
import '../features/seats/seats_screen.dart';
import '../state/providers.dart';
import 'shell.dart';

/// Routes, and the two redirects that matter.
///
/// Both are guard rails rather than authorisation. The server refuses every
/// request from a signed-out caller and every request for an organisation the
/// caller has no membership in; these only decide which screen is worth
/// rendering, so that a dispatcher never sits looking at an empty queue that
/// is empty because they are on the wrong screen.
GoRouter buildRouter(Ref ref) {
  return GoRouter(
    initialLocation: '/queue',
    refreshListenable: _Refresh(ref),
    redirect: (context, state) {
      final signedIn = ref.read(sessionProvider);
      final onSignIn = state.matchedLocation == '/sign-in';

      if (!signedIn) return onSignIn ? null : '/sign-in';
      if (onSignIn) return '/queue';

      // Signed in but no operator chosen yet. Every screen below the shell is
      // scoped to one, so there is nothing to render until it is picked.
      final chosen = ref.read(selectedOrganizationIdProvider);
      final onPicker = state.matchedLocation == '/organizations';
      if (chosen == null) return onPicker ? null : '/organizations';
      if (onPicker) return '/queue';

      return null;
    },
    routes: [
      GoRoute(
        path: '/sign-in',
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: '/organizations',
        builder: (context, state) => const OrganizationPickerScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => ConsoleShell(child: child),
        routes: [
          GoRoute(
            path: '/queue',
            builder: (context, state) => const QueueScreen(),
          ),
          GoRoute(
            path: '/roster',
            builder: (context, state) => const RosterScreen(),
          ),
          GoRoute(
            path: '/fleet',
            builder: (context, state) => const FleetScreen(),
          ),
          GoRoute(
            path: '/seats',
            builder: (context, state) => const SeatsScreen(),
          ),
        ],
      ),
    ],
  );
}

/// Re-runs the redirect when the session or the chosen operator changes.
class _Refresh extends ChangeNotifier {
  _Refresh(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
    ref.listen(selectedOrganizationIdProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) => buildRouter(ref));
