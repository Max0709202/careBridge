// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Registration, sign-in, sessions, verification and recovery
class AuthApi {
  const AuthApi(this._client);

  final CareBridgeApiClient _client;

  /// Create an account
  ///
  /// Signs the new account in immediately and sends a verification email.
  /// Nothing is blocked on verification — locking a family out of a ride they
  /// have already booked because an email went to spam is the worse outcome —
  /// but invitations require a verified address.
  Future<SessionResponseDto> register({required RegisterDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/auth/register',
      body: body.toJson(),
    );
    return SessionResponseDto.fromJson(response as Map<String, dynamic>);
  }

  /// Sign in
  ///
  /// Accounts with two-factor authentication confirmed must also send
  /// `mfaCode`. The code is checked only after the password, so an attacker
  /// without the password never learns whether an account has MFA at all.
  Future<SessionResponseDto> login({required LoginDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/auth/login',
      body: body.toJson(),
    );
    return SessionResponseDto.fromJson(response as Map<String, dynamic>);
  }

  /// Rotate the refresh token
  ///
  /// Single-use. Presenting one that has already been rotated revokes the whole
  /// family and forces a fresh sign-in: two parties hold tokens from one login
  /// and only one of them is legitimate.
  Future<TokenPairDto> refresh({required RefreshDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/auth/refresh',
      body: body.toJson(),
    );
    return TokenPairDto.fromJson(response as Map<String, dynamic>);
  }

  /// Sign out of this device, or of all of them
  Future<void> logout({required LogoutDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/logout',
      body: body.toJson(),
    );
    return;
  }

  /// Sign out everywhere
  ///
  /// Revokes every refresh token and raises the account’s token version, so
  /// access tokens already in the wild stop working on their next request
  /// rather than at their next expiry.
  Future<void> logoutAll() async {
    await _client.send(method: 'POST', path: '/auth/logout-all');
    return;
  }

  /// Confirm an email address with the emailed token
  Future<void> verifyEmail({required TokenDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/verify-email',
      body: body.toJson(),
    );
    return;
  }

  /// Send the verification email again
  ///
  /// Always accepted. Whether the address has an account, and whether it is
  /// already verified, are facts about a person that an unauthenticated caller
  /// does not get to read.
  Future<void> resendVerification({required EmailOnlyDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/resend-verification',
      body: body.toJson(),
    );
    return;
  }

  /// Request a password reset link
  ///
  /// Always accepted, whether or not the address has an account. Anything else
  /// turns this endpoint into a way to enumerate the customer list — which for
  /// this product is a list of people with a vulnerable relative.
  Future<void> requestPasswordReset({required EmailOnlyDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/password-reset',
      body: body.toJson(),
    );
    return;
  }

  /// Set a new password with the emailed token
  ///
  /// Revokes every session and emails the account holder that it happened. A
  /// reset that leaves sessions alive hands an attacker who already has one a
  /// foothold the new password does not dislodge.
  Future<void> confirmPasswordReset({required ResetPasswordDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/password-reset/confirm',
      body: body.toJson(),
    );
    return;
  }

  /// Change the password while signed in
  Future<void> changePassword({required ChangePasswordDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/password',
      body: body.toJson(),
    );
    return;
  }

  /// List active sessions
  ///
  /// One row per sign-in, not per token. Tokens rotate every few minutes; the
  /// family id is stable for the life of a session, so it is what a person
  /// recognises and can act on.
  Future<List<SessionSummaryDto>> listSessions() async {
    final response = await _client.send(method: 'GET', path: '/auth/sessions');
    return (response as List<dynamic>)
        .map((e) => SessionSummaryDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Revoke one session
  Future<void> revokeSession({required String id}) async {
    await _client.send(
      method: 'DELETE',
      path: '/auth/sessions/${Uri.encodeComponent(id)}',
    );
    return;
  }

  /// Two-factor authentication status
  Future<MfaStatusDto> mfaStatus() async {
    final response = await _client.send(method: 'GET', path: '/auth/mfa');
    return MfaStatusDto.fromJson(response as Map<String, dynamic>);
  }

  /// Turn two-factor authentication off
  Future<void> disableMfa() async {
    await _client.send(method: 'DELETE', path: '/auth/mfa');
    return;
  }

  /// Begin two-factor enrolment
  ///
  /// Returns the QR payload and the recovery codes, once. Enrolment is not
  /// active until a code is confirmed — marking it active here would lock out
  /// anyone whose authenticator app failed to scan the code, with no second
  /// factor to recover with.
  Future<MfaEnrolmentDto> beginMfaEnrolment() async {
    final response = await _client.send(
      method: 'POST',
      path: '/auth/mfa/enrol',
    );
    return MfaEnrolmentDto.fromJson(response as Map<String, dynamic>);
  }

  /// Confirm enrolment with one generated code
  Future<void> confirmMfa({required MfaCodeDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/auth/mfa/confirm',
      body: body.toJson(),
    );
    return;
  }
}
