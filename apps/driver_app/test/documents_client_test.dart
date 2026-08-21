import 'dart:convert';
import 'dart:typed_data';

import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:carebridge_driver/data/driver_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Uploading a licence.
///
/// Three steps rather than one, because the bytes never pass through the API:
/// the server signs a URL for exactly this file, the phone PUTs straight to
/// storage, and the server then checks storage rather than believing this app.
///
/// The property worth protecting is the middle step. It goes to a different
/// host, carries no session, and must send **exactly** the headers the
/// signature covers — anything added or altered is a 403 from storage.

class Recorder {
  final List<http.Request> requests = [];
  int uploadStatus = 200;

  http.Client get client => MockClient((request) async {
    requests.add(request);

    if (request.url.path.contains('/storage/')) {
      return http.Response('', uploadStatus);
    }

    if (request.url.path.endsWith('/driver/documents') &&
        request.method == 'POST') {
      return _json({
        'documentId': 'doc-1',
        'url': 'https://storage.test/storage/local/tok',
        'headers': {'content-type': 'image/jpeg', 'content-length': '9'},
        'expiresInSeconds': 600,
        'maxBytes': 10485760,
      });
    }

    return _json({
      'compliant': false,
      'missing': ['vehicleInsurance'],
      'expiringSoon': <String>[],
      'documents': <dynamic>[],
    });
  });

  http.Response _json(Map<String, dynamic> body) => http.Response(
    jsonEncode(body),
    200,
    headers: {'content-type': 'application/json'},
  );
}

Future<DriverApi> apiFor(Recorder recorder) async {
  final tokens = InMemoryTokenStore();
  await tokens.write(
    const AuthTokens(accessToken: 'access', refreshToken: 'refresh'),
  );
  return DriverApi(
    tokens: tokens,
    baseUrl: 'https://api.test/api/v1',
    client: recorder.client,
  );
}

void main() {
  test(
    'authorising an upload asks for a slot rather than sending the file',
    () async {
      final recorder = Recorder();
      final api = await apiFor(recorder);

      final slot = await api.authoriseUpload(
        kind: 'driversLicence',
        contentType: 'image/jpeg',
      );

      expect(slot.documentId, 'doc-1');
      expect(slot.url, contains('/storage/'));
      // The request that authorised it carried no image.
      final authorise = recorder.requests.single;
      expect(authorise.body, isNot(contains('�')));
      expect(
        jsonDecode(authorise.body),
        containsPair('kind', 'driversLicence'),
      );
    },
  );

  test('sends the bytes with exactly the headers that were signed', () async {
    final recorder = Recorder();
    final api = await apiFor(recorder);

    final slot = wire.PresignedUploadDto(
      documentId: 'doc-1',
      url: 'https://storage.test/storage/local/tok',
      headers: {
        'content-type': 'image/jpeg',
        'x-amz-server-side-encryption': 'AES256',
      },
      expiresInSeconds: 600,
      maxBytes: 10,
    );

    await api.uploadBytes(slot: slot, bytes: Uint8List.fromList([1, 2, 3]));

    final upload = recorder.requests.single;
    expect(upload.method, 'PUT');
    expect(upload.headers['content-type'], 'image/jpeg');
    expect(upload.headers['x-amz-server-side-encryption'], 'AES256');
  });

  test('never attaches the session to the upload', () async {
    // It goes to storage, not to this API. An Authorization header there is a
    // bearer token handed to a third party — and S3 would reject the request
    // for it anyway, which is the confusing half of the bug.
    final recorder = Recorder();
    final api = await apiFor(recorder);

    await api.uploadBytes(
      slot: wire.PresignedUploadDto(
        documentId: 'doc-1',
        url: 'https://storage.test/storage/local/tok',
        headers: {'content-type': 'image/jpeg'},
        expiresInSeconds: 600,
        maxBytes: 10,
      ),
      bytes: Uint8List.fromList([1, 2, 3]),
    );

    final upload = recorder.requests.single;
    expect(
      upload.headers.keys.map((k) => k.toLowerCase()),
      isNot(contains('authorization')),
    );
  });

  test('reports a storage refusal as a failure, not as success', () async {
    final recorder = Recorder()..uploadStatus = 403;
    final api = await apiFor(recorder);

    await expectLater(
      api.uploadBytes(
        slot: wire.PresignedUploadDto(
          documentId: 'doc-1',
          url: 'https://storage.test/storage/local/tok',
          headers: {'content-type': 'image/jpeg'},
          expiresInSeconds: 600,
          maxBytes: 10,
        ),
        bytes: Uint8List.fromList([1]),
      ),
      throwsA(isA<Failure>()),
    );
  });

  test('confirming asks the server to check storage', () async {
    final recorder = Recorder();
    final api = await apiFor(recorder);

    final documents = await api.confirmUpload('doc-1');

    expect(documents.compliant, isFalse);
    expect(documents.missing, contains('vehicleInsurance'));
    expect(
      recorder.requests.single.url.path,
      endsWith('/driver/documents/confirm'),
    );
  });

  test('reads what is still wanted', () async {
    final recorder = Recorder();
    final api = await apiFor(recorder);

    final documents = await api.documents();
    expect(documents.missing, ['vehicleInsurance']);
  });
}
