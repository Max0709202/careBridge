// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DeletionTokenDto, from the CareBridge API.
class DeletionTokenDto {
  const DeletionTokenDto({required this.token});

  /// The single-use token from the emailed link.
  final String token;

  factory DeletionTokenDto.fromJson(Map<String, dynamic> json) =>
      DeletionTokenDto(token: json['token'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'token': token};
}
