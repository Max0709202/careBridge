// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// LookupDriverAccountDto, from the CareBridge API.
class LookupDriverAccountDto {
  const LookupDriverAccountDto({required this.email});

  /// The full address the person signed up with. There is no partial match.
  final String email;

  factory LookupDriverAccountDto.fromJson(Map<String, dynamic> json) =>
      LookupDriverAccountDto(email: json['email'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'email': email};
}
