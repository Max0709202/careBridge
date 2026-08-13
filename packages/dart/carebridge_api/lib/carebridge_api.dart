// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// The generated CareBridge API client.
///
/// ```dart
/// final client = CareBridgeApiClient(
///   baseUrl: 'http://localhost:3000/api/v1',
///   accessToken: () async => tokenStore.accessToken,
///   onUnauthorized: tokenStore.refresh,
/// );
/// final auth = AuthApi(client);
/// ```
library;

export 'src/api_client.dart';
export 'src/models.dart';
export 'src/api/appointments_api.dart';
export 'src/api/auth_api.dart';
export 'src/api/care_api.dart';
export 'src/api/clinics_api.dart';
export 'src/api/me_api.dart';
export 'src/api/notifications_api.dart';
export 'src/api/patients_api.dart';
export 'src/api/rides_api.dart';
export 'src/api/system_api.dart';
