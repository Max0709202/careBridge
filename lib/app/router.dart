import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/appointments/appointment_detail_screen.dart';
import '../features/appointments/appointment_form_screen.dart';
import '../features/appointments/appointments_screen.dart';
import '../features/auth/accept_invitation_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/patients/patient_detail_screen.dart';
import '../features/patients/care_circle_screen.dart';
import '../features/patients/patient_form_screen.dart';
import '../features/rides/ride_detail_screen.dart';
import '../features/rides/ride_request_screen.dart';
import '../features/rides/tracking_screen.dart';
import '../features/settings/account_security_screen.dart';
import '../features/settings/notification_preferences_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/settings/two_factor_screen.dart';
import '../state/providers.dart';
import '../widgets/common.dart';
import 'home_shell.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

final routerProvider = Provider<GoRouter>((ref) {
  // GoRouter is built once and refreshed through a listenable rather than being
  // rebuilt when auth changes — rebuilding it would drop navigation state.
  final authChanged = ValueNotifier<bool>(ref.read(careProvider).isSignedIn);
  ref.listen(
    careProvider.select((state) => state.isSignedIn),
    (_, next) => authChanged.value = next,
  );
  ref.onDispose(authChanged.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    refreshListenable: authChanged,

    /// The client-side guard. It hides screens; it does not protect data — that
    /// is the server's job, on every request. See docs/FOUNDATION.md §9.
    redirect: (context, state) {
      final signedIn = ref.read(careProvider).isSignedIn;
      final location = state.matchedLocation;
      final isAuthRoute = location == '/sign-in' || location == '/register';

      if (!signedIn && !isAuthRoute) return '/sign-in';
      if (signedIn && isAuthRoute) return '/';
      return null;
    },
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(),
      body: EmptyState(
        icon: Icons.explore_off_outlined,
        title: 'That page does not exist',
        message: 'The link may be out of date.',
        action: FilledButton(
          onPressed: () => context.go('/'),
          child: const Text('Back to home'),
        ),
      ),
    ),
    routes: [
      GoRoute(
        path: '/sign-in',
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),

      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            HomeShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, state) => const DashboardScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/appointments',
                builder: (context, state) => const AppointmentsScreen(),
                routes: [
                  // Ordered before ':id' so "new" is never read as an id.
                  GoRoute(
                    path: 'new',
                    builder: (context, state) => const AppointmentFormScreen(),
                  ),
                  GoRoute(
                    path: ':id',
                    builder: (context, state) => AppointmentDetailScreen(
                      appointmentId: state.pathParameters['id']!,
                    ),
                    routes: [
                      GoRoute(
                        path: 'transport',
                        builder: (context, state) => RideRequestScreen(
                          appointmentId: state.pathParameters['id']!,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/notifications',
                builder: (context, state) => const NotificationsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsScreen(),
                routes: [
                  GoRoute(
                    path: 'security',
                    builder: (context, state) => const AccountSecurityScreen(),
                    routes: [
                      GoRoute(
                        path: 'two-factor',
                        builder: (context, state) => const TwoFactorScreen(),
                      ),
                    ],
                  ),
                  GoRoute(
                    path: 'notifications',
                    builder: (context, state) =>
                        const NotificationPreferencesScreen(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),

      // Full-screen routes, outside the shell: tracking and forms deserve the
      // whole screen rather than competing with a navigation bar.
      GoRoute(
        path: '/accept-invitation',
        parentNavigatorKey: _rootKey,
        builder: (context, state) => AcceptInvitationScreen(
          token: state.uri.queryParameters['token'] ?? '',
        ),
      ),
      GoRoute(
        path: '/patients/new',
        parentNavigatorKey: _rootKey,
        builder: (context, state) => const PatientFormScreen(),
      ),
      GoRoute(
        path: '/patients/:id',
        parentNavigatorKey: _rootKey,
        builder: (context, state) => PatientDetailScreen(
          patientId: state.pathParameters['id']!,
        ),
        routes: [
          GoRoute(
            path: 'care-circle',
            parentNavigatorKey: _rootKey,
            builder: (context, state) => CareCircleScreen(
              patientId: state.pathParameters['id']!,
            ),
          ),
          GoRoute(
            path: 'edit',
            parentNavigatorKey: _rootKey,
            builder: (context, state) => PatientFormScreen(
              patientId: state.pathParameters['id']!,
            ),
          ),
        ],
      ),
      GoRoute(
        path: '/rides/:id',
        parentNavigatorKey: _rootKey,
        builder: (context, state) => RideDetailScreen(
          rideId: state.pathParameters['id']!,
        ),
        routes: [
          GoRoute(
            path: 'track',
            parentNavigatorKey: _rootKey,
            builder: (context, state) => TrackingScreen(
              rideId: state.pathParameters['id']!,
            ),
          ),
        ],
      ),
    ],
  );
});
