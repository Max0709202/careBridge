import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter_test/flutter_test.dart';

/// Where the API is, and the one build mistake that cannot be recovered from
/// after release.
///
/// The default base URL is the relative `/api/v1`, and on web that is the
/// whole design: each app is served by an nginx that proxies `/api` from the
/// same origin, so there is no CORS, no hostname compiled into the bundle and
/// nothing for `connect-src 'self'` to have to allow.
///
/// Off web the same default is silently fatal. There is no page to be relative
/// to — `Uri.base` is the working directory — so it resolves to a `file:` URL
/// and every request fails as a connection error. The app renders that,
/// correctly for what it can see, as "We could not reach CareBridge. Check
/// your connection": the same sentence a phone in a tunnel gets. An iOS or
/// Android build that forgot its `--dart-define` therefore compiles, signs,
/// uploads, passes review, installs, opens, and is broken for everybody who
/// downloads it while blaming each of them for their network.
///
/// These tests run on the VM, which is to say off web — so the mobile case
/// here is the real one, not a simulation of it.
void main() {
  group('an absolute URL', () {
    test('is taken as given', () {
      expect(
        ApiTransport.resolveBaseUrl('https://api.carebridge.example/api/v1'),
        Uri.parse('https://api.carebridge.example/api/v1'),
      );
    });

    test('keeps a port and a path prefix', () {
      expect(
        ApiTransport.resolveBaseUrl('http://10.0.2.2:3000/api/v1').toString(),
        'http://10.0.2.2:3000/api/v1',
      );
    });

    test('loses a trailing slash, so paths are joined once', () {
      // Every call site appends `/rides`, and `…/api/v1//rides` is a 404 that
      // reads like a permission problem.
      expect(
        ApiTransport.resolveBaseUrl(
          'https://api.carebridge.example/api/v1/',
        ).toString(),
        'https://api.carebridge.example/api/v1',
      );
    });
  });

  group('a relative URL off web', () {
    test('is refused rather than resolved against the working directory', () {
      expect(
        () => ApiTransport.resolveBaseUrl('/api/v1'),
        throwsA(isA<StateError>()),
      );
    });

    test('is refused when it is the default, which is the shipping case', () {
      // The mistake is an omission, not a wrong value: nobody types `/api/v1`
      // into a release build, they just leave the --dart-define off.
      expect(
        () => ApiTransport.resolveBaseUrl(ApiTransport.configuredBaseUrl),
        throwsA(isA<StateError>()),
      );
    });

    test('says what to do about it, with the flag spelled out', () {
      // This message is read once, by someone who has just been told their
      // app cannot reach the network and does not yet know why. It has to
      // carry the fix, not a diagnosis.
      expect(
        () => ApiTransport.resolveBaseUrl('/api/v1'),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            allOf(
              contains('CAREBRIDGE_API_BASE_URL'),
              contains('--dart-define'),
            ),
          ),
        ),
      );
    });
  });
}
