// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DocumentViewUrlDto, from the CareBridge API.
class DocumentViewUrlDto {
  const DocumentViewUrlDto({required this.url, required this.expiresInSeconds});

  /// Short-lived on purpose. A link to a driver’s licence that works for a week
  /// is a link that ends up in a chat message, an email thread and a browser
  /// history.
  final String url;

  final int expiresInSeconds;

  factory DocumentViewUrlDto.fromJson(Map<String, dynamic> json) =>
      DocumentViewUrlDto(
        url: json['url'] as String,
        expiresInSeconds: json['expiresInSeconds'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'url': url,
    'expiresInSeconds': expiresInSeconds,
  };
}
