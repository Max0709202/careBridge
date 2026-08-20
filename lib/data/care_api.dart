import 'dart:async';
import 'dart:convert';

// Prefixed on purpose. The generated package carries the **wire** types, and
// several of them share a name with this app's own domain enums —
// `FamilyPermission`, `AppointmentType`. The prefix keeps the domain model
// primary, which is the right way round: the UI is written against the domain,
// and the wire shape is an implementation detail of this file.
import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:http/http.dart' as http;

import 'package:carebridge_client/carebridge_client.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import 'care_codec.dart';
import 'care_state.dart';

/// A snapshot plus the ids of any preview trips the server is running.
class CareSnapshot {
  const CareSnapshot({required this.state, required this.runningPreviews});

  final CareState state;
  final Set<String> runningPreviews;
}

/// The HTTP client for the CareBridge API.
///
/// Every mutating call returns a **whole** snapshot rather than a delta. One
/// status change can touch a ride, its appointment and the notification list at
/// once, and reassembling three partial responses on the client is how a UI
/// drifts out of step with the server that is supposed to be authoritative.
class CareApi {
  CareApi({required this.tokens, String? baseUrl, http.Client? client})
    : _baseUrl = _resolveBaseUrl(baseUrl ?? _configuredBaseUrl),
      _client = client ?? http.Client();

  final TokenStore tokens;
  final Uri _baseUrl;
  final http.Client _client;

  /// Relative by default, because the Docker stack serves the app and proxies
  /// `/api` to the API from the same origin — which means no CORS, and no API
  /// hostname compiled into the JavaScript bundle.
  ///
  /// Override for `flutter run` against a separate host:
  /// `--dart-define=CAREBRIDGE_API_BASE_URL=http://localhost:3000/api/v1`
  static const _configuredBaseUrl = String.fromEnvironment(
    'CAREBRIDGE_API_BASE_URL',
    defaultValue: '/api/v1',
  );

  static Uri _resolveBaseUrl(String raw) {
    final trimmed = raw.endsWith('/') ? raw.substring(0, raw.length - 1) : raw;
    // A relative value is resolved against the page the app was served from,
    // which is exactly what makes the same-origin proxy work.
    return Uri.base.resolve(trimmed.isEmpty ? '/' : trimmed);
  }

  void dispose() => _client.close();

  // ─── session ──────────────────────────────────────────────────────────────

  Future<CareSnapshot> register({
    required String fullName,
    required String email,
    required String password,
    required bool acceptedTerms,
  }) => _session('/auth/register', {
    'fullName': fullName.trim(),
    'email': email.trim(),
    'password': password,
    'acceptedTerms': acceptedTerms,
  });

  Future<CareSnapshot> signIn({
    required String email,
    required String password,
  }) => _session('/auth/login', {'email': email.trim(), 'password': password});

  Future<CareSnapshot> _session(String path, Map<String, dynamic> body) async {
    final json = await _send('POST', path, body: body, authenticated: false);
    await tokens.write(
      AuthTokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      ),
    );
    return _snapshot(json['state'] as Map<String, dynamic>);
  }

  Future<void> signOut() async {
    final stored = await tokens.read();
    try {
      if (stored != null) {
        await _send(
          'POST',
          '/auth/logout',
          body: {'refreshToken': stored.refreshToken},
        );
      }
    } catch (_) {
      // Signing out locally must succeed even when the server cannot be
      // reached. The refresh token is discarded either way, and the access
      // token expires on its own within minutes.
    } finally {
      await tokens.clear();
    }
  }

  /// Restores a session from stored tokens, or returns null if there is none.
  Future<CareSnapshot?> restore() async {
    if (await tokens.read() == null) return null;
    try {
      return await state();
    } on AuthenticationFailure {
      await tokens.clear();
      return null;
    }
  }

  // ─── reads ────────────────────────────────────────────────────────────────

  Future<CareSnapshot> state() async =>
      _snapshot(await _send('GET', '/care/state'));

  // ─── preferences ──────────────────────────────────────────────────────────

  Future<CareSnapshot> setSimplifiedMode(bool enabled) async => _snapshot(
    await _send('PATCH', '/me/preferences', body: {'simplifiedMode': enabled}),
  );

  Future<CareSnapshot> selectPatient(String patientId) async =>
      _snapshot(await _send('POST', '/patients/$patientId/select'));

  // ─── patients ─────────────────────────────────────────────────────────────

  /// The key is generated per call rather than per retry, which is the whole
  /// point: one tap is one key, and every attempt to deliver that tap — a
  /// refresh-and-retry inside [_send], or a user pressing the button again
  /// after a spinner that never resolved — carries it.
  Future<CareSnapshot> createPatient(Patient patient) async => _snapshot(
    await _send(
      'POST',
      '/patients',
      body: patientToJson(patient),
      idempotencyKey: newId(),
    ),
  );

  Future<CareSnapshot> updatePatient(Patient patient) async => _snapshot(
    await _send('PUT', '/patients/${patient.id}', body: patientToJson(patient)),
  );

  Future<CareSnapshot> archivePatient(String patientId) async =>
      _snapshot(await _send('POST', '/patients/$patientId/archive'));

  Future<CareSnapshot> setPermissions(
    String patientId,
    Set<FamilyPermission> permissions,
  ) async => _snapshot(
    await _send(
      'PUT',
      '/patients/$patientId/permissions',
      body: {'permissions': permissions.map((p) => p.name).toList()},
    ),
  );

  // ─── the account ──────────────────────────────────────────────────────────
  //
  // Responses are decoded into the **generated** DTOs from `carebridge_api`.
  // Those types come from the same OpenAPI document the server emits, so a
  // field that changes shape on the server is a compile error here rather than
  // a null at runtime on somebody's settings screen.

  Future<List<wire.SessionSummaryDto>> sessions() async =>
      (await _sendList('GET', '/auth/sessions'))
          .map(
            (e) => wire.SessionSummaryDto.fromJson(e as Map<String, dynamic>),
          )
          .toList();

  Future<void> revokeSession(String sessionId) async =>
      _send('DELETE', '/auth/sessions/$sessionId');

  /// Signs out everywhere, including this device.
  ///
  /// The local tokens are cleared regardless of what the server said: once the
  /// call has gone out, the access token is dead on its next use anyway, and
  /// keeping it would leave the app in a state where every request 401s.
  Future<void> signOutEverywhere() async {
    try {
      await _send('POST', '/auth/logout-all');
    } finally {
      await tokens.clear();
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async => _send(
    'POST',
    '/auth/password',
    body: {'currentPassword': currentPassword, 'newPassword': newPassword},
  );

  Future<void> requestPasswordReset(String email) async => _send(
    'POST',
    '/auth/password-reset',
    body: {'email': email.trim()},
    authenticated: false,
  );

  Future<void> resendVerification(String email) async => _send(
    'POST',
    '/auth/resend-verification',
    body: {'email': email.trim()},
    authenticated: false,
  );

  Future<void> verifyEmail(String token) async => _send(
    'POST',
    '/auth/verify-email',
    body: {'token': token},
    authenticated: false,
  );

  // ─── two-factor authentication ────────────────────────────────────────────

  Future<wire.MfaStatusDto> mfaStatus() async =>
      wire.MfaStatusDto.fromJson(await _send('GET', '/auth/mfa'));

  Future<wire.MfaEnrolmentDto> beginMfaEnrolment() async =>
      wire.MfaEnrolmentDto.fromJson(await _send('POST', '/auth/mfa/enrol'));

  Future<void> confirmMfa(String code) async =>
      _send('POST', '/auth/mfa/confirm', body: {'code': code});

  Future<void> disableMfa() async => _send('DELETE', '/auth/mfa');

  // ─── notification preferences ─────────────────────────────────────────────

  Future<List<wire.NotificationPreferenceDto>>
  notificationPreferences() async =>
      (await _sendList('GET', '/notifications/preferences'))
          .map(
            (e) => wire.NotificationPreferenceDto.fromJson(
              e as Map<String, dynamic>,
            ),
          )
          .toList();

  Future<List<wire.NotificationPreferenceDto>> setNotificationPreference({
    required String kind,
    required String channel,
    required bool enabled,
  }) async =>
      (await _sendList(
            'PUT',
            '/notifications/preferences',
            body: {'kind': kind, 'channel': channel, 'enabled': enabled},
          ))
          .map(
            (e) => wire.NotificationPreferenceDto.fromJson(
              e as Map<String, dynamic>,
            ),
          )
          .toList();

  // ─── billing ──────────────────────────────────────────────────────────────

  /// The household's own subscription, or null if it has none.
  ///
  /// Null is a real state rather than an error: an account created before the
  /// two-sided fee model existed has no billing account, and telling that
  /// person "something went wrong" instead of "choose a plan" would be a lie
  /// about whose problem it is.
  Future<wire.BillingAccountDto?> billingAccount() async {
    final json = await _send('GET', '/billing/account');
    if (json.isEmpty) return null;
    return wire.BillingAccountDto.fromJson(json);
  }

  /// The catalogue. Plans are rows on the server; nothing about a price,
  /// a tier or an entitlement is compiled into this app.
  Future<List<wire.SubscriptionPlanDto>> billingPlans({
    String payer = 'family',
  }) async => (await _sendList('GET', '/billing/plans?payer=$payer'))
      .map((e) => wire.SubscriptionPlanDto.fromJson(e as Map<String, dynamic>))
      .toList();

  Future<wire.BillingAccountDto> subscribe({
    required String planCode,
    required String interval,
  }) async => wire.BillingAccountDto.fromJson(
    await _send(
      'POST',
      '/billing/subscribe',
      body: {'planCode': planCode, 'interval': interval},
      // Choosing a plan is a thing that gets double-tapped on a slow
      // connection, and the second tap must not open a second subscription.
      idempotencyKey: newId(),
    ),
  );

  Future<wire.BillingAccountDto> changeBillingInterval(String interval) async =>
      wire.BillingAccountDto.fromJson(
        await _send(
          'POST',
          '/billing/change-interval',
          body: {'interval': interval},
        ),
      );

  Future<wire.BillingAccountDto> cancelSubscription() async =>
      wire.BillingAccountDto.fromJson(await _send('POST', '/billing/cancel'));

  /// What this household has been billed, newest first.
  Future<List<wire.InvoiceDto>> invoices() async => (await _sendList(
    'GET',
    '/billing/invoices',
  )).map((e) => wire.InvoiceDto.fromJson(e as Map<String, dynamic>)).toList();

  /// Puts a card on file.
  ///
  /// [token] is a reference obtained **directly from the payment processor**.
  /// This app never holds a card number and this method cannot be given one:
  /// the field is a token, the API refuses anything else, and ADR-0006 is the
  /// reason the boundary sits here rather than one layer further in.
  Future<wire.PaymentMethodDto> attachPaymentMethod(String token) async =>
      wire.PaymentMethodDto.fromJson(
        await _send(
          'POST',
          '/billing/payment-method',
          body: {'token': token},
          // Adding a card is double-tapped on a slow connection like anything
          // else, and the second tap must not attach a second card.
          idempotencyKey: newId(),
        ),
      );

  Future<void> detachPaymentMethod(String id) async {
    await _send('DELETE', '/billing/payment-method/$id');
  }

  /// Charges an open invoice now.
  ///
  /// Exists for the moment after a declined card is replaced: waiting a day
  /// for the scheduled retry, while the screen still says the payment failed,
  /// reads as the update not having worked.
  Future<wire.InvoiceDto> payInvoice(String id) async =>
      wire.InvoiceDto.fromJson(
        await _send('POST', '/billing/invoices/$id/pay'),
      );

  // ─── the care circle ──────────────────────────────────────────────────────

  Future<List<wire.InvitationDto>> invitations(String patientId) async =>
      (await _sendList('GET', '/patients/$patientId/invitations'))
          .map((e) => wire.InvitationDto.fromJson(e as Map<String, dynamic>))
          .toList();

  Future<wire.InvitationDto> invite({
    required String patientId,
    required String email,
    required String relationship,
    required List<String> permissions,
  }) async => wire.InvitationDto.fromJson(
    await _send(
      'POST',
      '/patients/$patientId/invitations',
      // A retried invitation is a second email to someone who is already
      // deciding whether to accept the first.
      idempotencyKey: newId(),
      body: {
        'email': email.trim(),
        'relationship': relationship,
        'permissions': permissions,
      },
    ),
  );

  Future<void> revokeInvitation({
    required String patientId,
    required String invitationId,
  }) async => _send('DELETE', '/patients/$patientId/invitations/$invitationId');

  /// Accepting returns the whole snapshot — it now includes a patient the
  /// caller could not see a moment ago.
  Future<CareSnapshot> acceptInvitation(String token) async => _snapshot(
    await _send('POST', '/invitations/accept', body: {'token': token}),
  );

  // ─── clinics ──────────────────────────────────────────────────────────────

  Future<CareSnapshot> addClinic(Clinic clinic) async => _snapshot(
    await _send(
      'POST',
      '/clinics',
      body: clinicToJson(clinic),
      idempotencyKey: newId(),
    ),
  );

  // ─── appointments ─────────────────────────────────────────────────────────

  Future<CareSnapshot> createAppointment({
    required String patientId,
    required String clinicId,
    required DateTime startsAt,
    required Duration expectedDuration,
    required AppointmentType type,
    String? coordinationNotes,
    bool transportRequired = false,
  }) async => _snapshot(
    await _send(
      'POST',
      '/appointments',
      idempotencyKey: newId(),
      body: {
        'patientId': patientId,
        'clinicId': clinicId,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'expectedDurationMinutes': expectedDuration.inMinutes,
        'type': type.name,
        if (coordinationNotes != null && coordinationNotes.isNotEmpty)
          'coordinationNotes': coordinationNotes,
        'transportRequired': transportRequired,
      },
    ),
  );

  Future<CareSnapshot> rescheduleAppointment(
    String appointmentId,
    DateTime startsAt,
  ) async => _snapshot(
    await _send(
      'POST',
      '/appointments/$appointmentId/reschedule',
      body: {'startsAt': startsAt.toUtc().toIso8601String()},
    ),
  );

  Future<CareSnapshot> cancelAppointment(
    String appointmentId, {
    String? reason,
  }) async => _snapshot(
    await _send(
      'POST',
      '/appointments/$appointmentId/cancel',
      body: {if (reason != null && reason.isNotEmpty) 'reason': reason},
    ),
  );

  // ─── transportation ───────────────────────────────────────────────────────

  Future<CareSnapshot> requestTransport({
    required String appointmentId,
    required DateTime pickupAt,
    required bool roundTrip,
    String? notesForDriver,
  }) async => _snapshot(
    await _send(
      'POST',
      '/rides',
      // A dropped response here is the case this exists for: retrying it
      // without a key books a second car for the same appointment, and bills
      // for it.
      idempotencyKey: newId(),
      body: {
        'appointmentId': appointmentId,
        'pickupAt': pickupAt.toUtc().toIso8601String(),
        'roundTrip': roundTrip,
        if (notesForDriver != null && notesForDriver.isNotEmpty)
          'notesForDriver': notesForDriver,
      },
    ),
  );

  Future<CareSnapshot> cancelRide(String rideId, String reason) async =>
      _snapshot(
        await _send('POST', '/rides/$rideId/cancel', body: {'reason': reason}),
      );

  Future<CareSnapshot> setDelay(
    String rideId, {
    required bool delayed,
    String? reason,
  }) async => _snapshot(
    await _send(
      'POST',
      '/rides/$rideId/delay',
      body: {
        'delayed': delayed,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    ),
  );

  /// Starts the server-side preview trip — the stand-in for the driver app.
  Future<CareSnapshot> startPreviewTrip(String rideId) async =>
      _snapshot(await _send('POST', '/rides/$rideId/preview/start'));

  Future<CareSnapshot> stopPreviewTrip(String rideId) async =>
      _snapshot(await _send('POST', '/rides/$rideId/preview/stop'));

  // ─── notifications ────────────────────────────────────────────────────────

  Future<CareSnapshot> markNotificationRead(String id) async =>
      _snapshot(await _send('POST', '/notifications/$id/read'));

  Future<CareSnapshot> markAllNotificationsRead() async =>
      _snapshot(await _send('POST', '/notifications/read-all'));

  // ─── transport plumbing ───────────────────────────────────────────────────

  CareSnapshot _snapshot(Map<String, dynamic> json) => CareSnapshot(
    state: careStateFromJson(json),
    runningPreviews: runningPreviewRideIds(json),
  );

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
    bool allowRetry = true,
    String? idempotencyKey,
  }) async {
    final response = await _request(
      method,
      path,
      body,
      authenticated,
      idempotencyKey,
    );

    // One refresh attempt, then give up. Looping on 401 would turn an expired
    // session into an infinite request storm against the auth endpoint.
    if (response.statusCode == 401 && authenticated && allowRetry) {
      if (await _refresh()) {
        return _send(
          method,
          path,
          body: body,
          authenticated: authenticated,
          allowRetry: false,
          // The same key on the retry, deliberately: a 401 that is fixed by a
          // refresh is one request, not two, and the server must be able to
          // tell if the first attempt landed before the token expired.
          idempotencyKey: idempotencyKey,
        );
      }
      await tokens.clear();
      throw const AuthenticationFailure();
    }

    return _decode(response);
  }

  /// The list-shaped sibling of [_send].
  ///
  /// Kept separate rather than making [_send] return `dynamic`: every existing
  /// caller decodes an object, and widening that return type would push a cast
  /// into forty call sites to serve four.
  Future<List<dynamic>> _sendList(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool allowRetry = true,
  }) async {
    final response = await _request(method, path, body, true);

    if (response.statusCode == 401 && allowRetry) {
      if (await _refresh()) {
        return _sendList(method, path, body: body, allowRetry: false);
      }
      await tokens.clear();
      throw const AuthenticationFailure();
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final decoded = response.body.isEmpty
          ? const <String, dynamic>{}
          : jsonDecode(response.body) as Map<String, dynamic>;
      throw _failureFrom(response.statusCode, decoded, response.headers);
    }

    return response.body.isEmpty
        ? const []
        : jsonDecode(response.body) as List<dynamic>;
  }

  Future<http.Response> _request(
    String method,
    String path,
    Map<String, dynamic>? body,
    bool authenticated, [
    String? idempotencyKey,
  ]) async {
    final uri = Uri.parse('$_baseUrl$path');
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      // Null-aware element: the header is simply absent when there is no key.
      'Idempotency-Key': ?idempotencyKey,
    };

    if (authenticated) {
      final stored = await tokens.read();
      if (stored == null) throw const AuthenticationFailure();
      headers['Authorization'] = 'Bearer ${stored.accessToken}';
    }

    final encoded = body == null ? null : jsonEncode(body);

    try {
      return switch (method) {
        'GET' => await _client.get(uri, headers: headers),
        'POST' => await _client.post(uri, headers: headers, body: encoded),
        'PUT' => await _client.put(uri, headers: headers, body: encoded),
        'PATCH' => await _client.patch(uri, headers: headers, body: encoded),
        'DELETE' => await _client.delete(uri, headers: headers, body: encoded),
        _ => throw ArgumentError('Unsupported method $method'),
      };
    } on http.ClientException {
      // The message a family member sees never carries a URL, a host or a
      // stack frame — see [Failure].
      throw const NetworkFailure();
    } on FormatException {
      throw const NetworkFailure();
    }
  }

  Future<bool> _refresh() async {
    final stored = await tokens.read();
    if (stored == null) return false;

    try {
      final json = await _send(
        'POST',
        '/auth/refresh',
        body: {'refreshToken': stored.refreshToken},
        authenticated: false,
        allowRetry: false,
      );
      await tokens.write(
        AuthTokens(
          accessToken: json['accessToken'] as String,
          refreshToken: json['refreshToken'] as String,
        ),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    final body = response.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode >= 200 && response.statusCode < 300) return body;

    throw _failureFrom(response.statusCode, body, response.headers);
  }

  /// Maps the server's error envelope onto the [Failure] types the UI renders.
  ///
  /// Delegated to `carebridge_client` rather than implemented here, because
  /// the ops console needs the identical mapping and the `404` branch is the
  /// reason: the API answers "no such record" and "not yours" identically on
  /// purpose, and a second implementation is where that ambiguity gets
  /// accidentally undone.
  Failure _failureFrom(
    int status,
    Map<String, dynamic> body,
    Map<String, String> headers,
  ) => failureFromResponse(status: status, body: body, headers: headers);
}
