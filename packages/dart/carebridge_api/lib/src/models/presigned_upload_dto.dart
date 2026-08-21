// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// PresignedUploadDto, from the CareBridge API.
class PresignedUploadDto {
  const PresignedUploadDto({
    required this.documentId,
    required this.url,
    required this.headers,
    required this.expiresInSeconds,
    required this.maxBytes,
  });

  final String documentId;

  /// PUT the file here. The bytes never pass through this API: a multipart body
  /// would be a copy of the file in the heap of a process that is also holding
  /// a WebSocket open for every live ride.
  final String url;

  /// Send these exactly. They are covered by the signature, which is what stops
  /// a slot authorised for a 4 MB photograph being filled with 400 MB of
  /// something else.
  final Map<String, String> headers;

  final int expiresInSeconds;

  final int maxBytes;

  factory PresignedUploadDto.fromJson(Map<String, dynamic> json) =>
      PresignedUploadDto(
        documentId: json['documentId'] as String,
        url: json['url'] as String,
        headers: (json['headers'] as Map<String, dynamic>).map(
          (k, v) => MapEntry(k, v as String),
        ),
        expiresInSeconds: json['expiresInSeconds'] as int,
        maxBytes: json['maxBytes'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'documentId': documentId,
    'url': url,
    'headers': headers.map((k, v) => MapEntry(k, v)),
    'expiresInSeconds': expiresInSeconds,
    'maxBytes': maxBytes,
  };
}
