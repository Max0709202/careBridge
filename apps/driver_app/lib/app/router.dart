import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/sign_in_screen.dart';
import '../features/documents/documents_screen.dart';
import '../features/job/job_screen.dart';
import '../features/today/today_screen.dart';
import '../state/providers.dart';

/// Three screens and one redirect.
///
/// The redirect is a guard rail rather than authorisation: the server refuses
/// every request from a signed-out caller regardless. It exists so a driver
/// never sits looking at an empty list that is empty because the session
/// expired in a car park.
GoRouter buildRouter(Ref ref) => GoRouter(
  initialLocation: '/today',
  refreshListenable: _Refresh(ref),
  redirect: (context, state) {
    final signedIn = ref.read(sessionProvider);
    final onSignIn = state.matchedLocation == '/sign-in';

    if (!signedIn) return onSignIn ? null : '/sign-in';
    if (onSignIn) return '/today';
    return null;
  },
  routes: [
    GoRoute(
      path: '/sign-in',
      builder: (context, state) => const SignInScreen(),
    ),
    GoRoute(path: '/today', builder: (context, state) => const TodayScreen()),
    GoRoute(
      path: '/documents',
      builder: (context, state) => const DocumentsScreen(),
    ),
    GoRoute(
      path: '/job/:rideId',
      builder: (context, state) =>
          JobScreen(rideId: state.pathParameters['rideId']!),
    ),
  ],
);

class _Refresh extends ChangeNotifier {
  _Refresh(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) => buildRouter(ref));
