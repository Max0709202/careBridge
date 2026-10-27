// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// WebPushKeyDto, from the CareBridge API.
class WebPushKeyDto {
  const WebPushKeyDto({this.publicKey});

  /// base64url VAPID public key.
  final String? publicKey;

  factory WebPushKeyDto.fromJson(Map<String, dynamic> json) =>
      WebPushKeyDto(publicKey: json['publicKey'] as String?);

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (publicKey != null) 'publicKey': publicKey,
  };
}
