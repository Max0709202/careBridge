import 'dart:convert';

import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_driver/data/driver_api.dart';
import 'package:carebridge_driver/features/apply/apply_screen.dart';
import 'package:carebridge_driver/features/auth/sign_up_screen.dart';
import 'package:carebridge_driver/state/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Becoming a driver without the operator typing anything: an account, a
/// verified address, and an application with the operator's join code.

Map<String, dynamic> profileJson({String status = 'pendingApproval'}) => {
  'driverId': 'driver-1',
  'organizationId': 'org-1',
  'organizationName': 'Meridian Transit Partners',
  'displayName': 'Priya R.',
  'status': status,
  'onShift': false,
  'canWork': false,
  'suspensionReason': null,
  'rejectionReason': null,
  'vehicle': {
    'id': 'vehicle-1',
    'make': 'Honda',
    'model': 'Odyssey',
    'color': 'Blue',
    'licensePlate': 'OH-AB12',
    'isWheelchairAccessible': false,
  },
};

class FakeServer {
  final List<http.Request> requests = [];
  Map<String, dynamic> onboarding = {
    'email': 'priya@example.com',
    'fullName': 'Priya Raman',
    'emailVerified': true,
    'hasDriverProfile': false,
  };
  http.Response Function(http.Request)? onApply;

  http.Client get client => MockClient((request) async {
    requests.add(request);
    final path = request.url.path;
    if (path.endsWith('/auth/register')) {
      return _json({'accessToken': 'a', 'refreshToken': 'r'});
    }
    if (path.endsWith('/auth/resend-verification')) {
      return http.Response('', 204);
    }
    if (path.endsWith('/driver/onboarding')) return _json(onboarding);
    if (path.endsWith('/driver/application')) {
      return onApply?.call(request) ?? _json(profileJson(), 201);
    }
    return _json(<String, dynamic>{}, 404);
  });

  http.Response _json(Map<String, dynamic> body, [int status = 200]) =>
      http.Response(
        jsonEncode(body),
        status,
        headers: {'content-type': 'application/json'},
      );

  Map<String, dynamic> bodyOf(String suffix) =>
      jsonDecode(requests.firstWhere((r) => r.url.path.endsWith(suffix)).body)
          as Map<String, dynamic>;
}

Future<DriverApi> apiFor(FakeServer server, {bool signedIn = true}) async {
  final tokens = InMemoryTokenStore();
  if (signedIn) {
    await tokens.write(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
  }
  return DriverApi(
    tokens: tokens,
    baseUrl: 'https://api.test/api/v1',
    client: server.client,
  );
}

Future<void> pumpAt(WidgetTester tester, String location, DriverApi api) async {
  // Tall enough that the whole form is built: a ListView only builds what is
  // on screen, and these tests fill in every field.
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final router = GoRouter(
    initialLocation: location,
    routes: [
      GoRoute(path: '/sign-up', builder: (_, _) => const SignUpScreen()),
      GoRoute(path: '/apply', builder: (_, _) => const ApplyScreen()),
      GoRoute(
        path: '/documents',
        builder: (_, _) => const Scaffold(body: Text('Paperwork screen')),
      ),
      GoRoute(
        path: '/today',
        builder: (_, _) => const Scaffold(body: Text('Today screen')),
      ),
      GoRoute(
        path: '/sign-in',
        builder: (_, _) => const Scaffold(body: Text('Sign-in screen')),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [driverApiProvider.overrideWithValue(api)],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> fillApplication(WidgetTester tester) async {
  Future<void> fill(String label, String value) =>
      tester.enterText(find.widgetWithText(TextFormField, label), value);
  await fill('Company code', 'k7qm-2rxd');
  await fill('Phone number', '555 010 0100');
  await fill('Years driving', '6');
  await fill('Make', 'Honda');
  await fill('Model', 'Odyssey');
  await fill('Colour', 'Blue');
  await fill('Licence plate', 'OH-AB12');
}

Future<void> send(WidgetTester tester) async {
  final button = find.text('Send application');
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void main() {
  group('the client', () {
    test('registers without a session and keeps the one it is given', () async {
      final server = FakeServer();
      final tokens = InMemoryTokenStore();
      final api = DriverApi(
        tokens: tokens,
        baseUrl: 'https://api.test/api/v1',
        client: server.client,
      );

      await api.register(
        fullName: ' Priya Raman ',
        email: 'priya@example.com ',
        password: 'long-enough-password',
      );

      final request = server.requests.single;
      expect(request.headers['authorization'], isNull);
      expect(server.bodyOf('/auth/register'), {
        'fullName': 'Priya Raman',
        'email': 'priya@example.com',
        'password': 'long-enough-password',
        'acceptedTerms': true,
      });
      expect((await tokens.read())?.accessToken, 'a');
    });

    test('sends the application with the vehicle nested', () async {
      final server = FakeServer();
      final api = await apiFor(server);

      final profile = await api.apply(
        joinCode: 'K7QM-2RXD',
        phone: '5550100100',
        yearsDriving: 6,
        make: 'Honda',
        model: 'Odyssey',
        color: 'Blue',
        licensePlate: 'OH-AB12',
        isWheelchairAccessible: true,
      );

      expect(profile.status, 'pendingApproval');
      expect(profile.isOffboarded, isFalse);
      expect(server.bodyOf('/driver/application'), {
        'joinCode': 'K7QM-2RXD',
        'phone': '5550100100',
        'yearsDriving': 6,
        'vehicle': {
          'make': 'Honda',
          'model': 'Odyssey',
          'color': 'Blue',
          'licensePlate': 'OH-AB12',
          'isWheelchairAccessible': true,
        },
      });
    });

    test('reads onboarding and asks for the email again', () async {
      final server = FakeServer();
      final api = await apiFor(server);

      final onboarding = await api.onboarding();
      expect(onboarding, isA<wire.DriverOnboardingDto>());
      expect(onboarding.fullName, 'Priya Raman');

      await api.resendVerification('priya@example.com');
      expect(server.bodyOf('/auth/resend-verification'), {
        'email': 'priya@example.com',
      });
    });
  });

  group('the sign-up screen', () {
    testWidgets('will not go without agreeing to the terms', (tester) async {
      final server = FakeServer();
      await pumpAt(tester, '/sign-up', await apiFor(server, signedIn: false));

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Full name'),
        'Priya Raman',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'),
        'priya@example.com',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Password'),
        'long-enough-password',
      );
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();

      expect(find.text('Agree to the terms to continue.'), findsOneWidget);
      expect(server.requests, isEmpty);

      await tester.tap(find.byType(Checkbox));
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();
      expect(server.bodyOf('/auth/register')['fullName'], 'Priya Raman');
    });

    testWidgets('checks the fields before sending anything', (tester) async {
      final server = FakeServer();
      await pumpAt(tester, '/sign-up', await apiFor(server, signedIn: false));

      await tester.tap(find.byType(Checkbox));
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();

      expect(find.text('Enter your name'), findsOneWidget);
      expect(find.text('Enter your email address'), findsOneWidget);
      expect(find.text('Use at least 10 characters'), findsOneWidget);
      expect(server.requests, isEmpty);
    });
  });

  group('the application screen', () {
    testWidgets('asks for a verified address first, and can resend', (
      tester,
    ) async {
      final server = FakeServer()
        ..onboarding = {
          'email': 'priya@example.com',
          'fullName': 'Priya Raman',
          'emailVerified': false,
          'hasDriverProfile': false,
        };
      await pumpAt(tester, '/apply', await apiFor(server));

      expect(find.text('Verify your email first'), findsOneWidget);
      await tester.tap(find.text('Send the email again'));
      await tester.pumpAndSettle();
      expect(find.text('Email sent again'), findsOneWidget);

      server.onboarding = {...server.onboarding, 'emailVerified': true};
      await tester.tap(find.text('I’ve verified'));
      await tester.pumpAndSettle();
      expect(find.text('Priya Raman'), findsOneWidget);
    });

    testWidgets('sends the application and goes on to the paperwork', (
      tester,
    ) async {
      final server = FakeServer();
      await pumpAt(tester, '/apply', await apiFor(server));

      expect(find.text('Priya Raman'), findsOneWidget);
      await fillApplication(tester);
      await send(tester);

      expect(find.text('Paperwork screen'), findsOneWidget);
      expect(server.bodyOf('/driver/application')['yearsDriving'], 6);
    });

    testWidgets('puts a code the server did not know under the field', (
      tester,
    ) async {
      final server = FakeServer()
        ..onApply = (_) => http.Response(
          jsonEncode({
            'error': {
              'code': 'validation',
              'message': 'That company code was not recognised.',
              'field': 'joinCode',
            },
          }),
          400,
          headers: {'content-type': 'application/json'},
        );
      await pumpAt(tester, '/apply', await apiFor(server));

      await fillApplication(tester);
      await send(tester);

      expect(
        find.text('That company code was not recognised.'),
        findsOneWidget,
      );
    });

    testWidgets('says plainly when the address is not verified yet', (
      tester,
    ) async {
      final server = FakeServer()
        ..onApply = (_) => http.Response(
          jsonEncode({
            'error': {
              'code': 'validation',
              'message': 'Verify your email address first.',
            },
          }),
          400,
          headers: {'content-type': 'application/json'},
        );
      await pumpAt(tester, '/apply', await apiFor(server));

      await fillApplication(tester);
      await send(tester);

      expect(find.text('Verify your email address first.'), findsOneWidget);
    });

    testWidgets('refuses an incomplete form without sending it', (
      tester,
    ) async {
      final server = FakeServer();
      await pumpAt(tester, '/apply', await apiFor(server));

      await send(tester);

      expect(
        find.text('Enter the code from your transport company'),
        findsOneWidget,
      );
      expect(find.text('A whole number from 0 to 60'), findsOneWidget);
      expect(
        server.requests.where((r) => r.url.path.endsWith('/application')),
        isEmpty,
      );
    });

    testWidgets('sends somebody who is already a driver to today', (
      tester,
    ) async {
      final server = FakeServer()
        ..onboarding = {
          'email': 'priya@example.com',
          'fullName': 'Priya Raman',
          'emailVerified': true,
          'hasDriverProfile': true,
        };
      await pumpAt(tester, '/apply', await apiFor(server));

      expect(find.text('Today screen'), findsOneWidget);
    });
  });
}
