// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// EmailOnlyDto, from the CareBridge API.
class EmailOnlyDto {
  const EmailOnlyDto({required this.email});

  final String email;

  factory EmailOnlyDto.fromJson(Map<String, dynamic> json) =>
      EmailOnlyDto(email: json['email'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'email': email};
}
