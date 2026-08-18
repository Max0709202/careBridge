import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The pair a signed-in session is made of.
///
/// The access token is short-lived (minutes) and sent on every request. The
/// refresh token is long-lived, opaque, and used exactly once — the server
/// rotates it on every use and revokes the whole family if a rotated one is
/// ever presented again.
@immutable
class AuthTokens {
  const AuthTokens({required this.accessToken, required this.refreshToken});

  final String accessToken;
  final String refreshToken;

  AuthTokens copyWith({String? accessToken, String? refreshToken}) =>
      AuthTokens(
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
      );
}

abstract class TokenStore {
  Future<AuthTokens?> read();
  Future<void> write(AuthTokens tokens);
  Future<void> clear();
}

/// Keychain on iOS/macOS, EncryptedSharedPreferences on Android, AES-encrypted
/// storage on web. Never plain shared preferences — see docs/FOUNDATION.md §9.
///
/// Every method degrades to "no session" rather than throwing. A platform
/// without a secure-storage implementation should land the user on the sign-in
/// screen, which is recoverable; an exception during startup is a white screen,
/// which is not.
class SecureTokenStore implements TokenStore {
  // No options needed: as of flutter_secure_storage 11 the Android backend is
  // encrypted unconditionally, so there is no longer a flag to forget.
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _accessKey = 'carebridge.accessToken';
  static const _refreshKey = 'carebridge.refreshToken';

  @override
  Future<AuthTokens?> read() async {
    try {
      final access = await _storage.read(key: _accessKey);
      final refresh = await _storage.read(key: _refreshKey);
      if (access == null || refresh == null) return null;
      return AuthTokens(accessToken: access, refreshToken: refresh);
    } catch (error) {
      debugPrint('Secure storage unavailable, starting signed out: $error');
      return null;
    }
  }

  @override
  Future<void> write(AuthTokens tokens) async {
    try {
      await _storage.write(key: _accessKey, value: tokens.accessToken);
      await _storage.write(key: _refreshKey, value: tokens.refreshToken);
    } catch (error) {
      // The session still works for as long as the app is open; it just will
      // not survive a restart. Better than failing the sign-in that succeeded.
      debugPrint('Could not persist session: $error');
    }
  }

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _accessKey);
      await _storage.delete(key: _refreshKey);
    } catch (error) {
      debugPrint('Could not clear session: $error');
    }
  }
}

/// For tests and for widget previews, where no platform channel exists.
class InMemoryTokenStore implements TokenStore {
  AuthTokens? _tokens;

  @override
  Future<AuthTokens?> read() async => _tokens;

  @override
  Future<void> write(AuthTokens tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async => _tokens = null;
}
