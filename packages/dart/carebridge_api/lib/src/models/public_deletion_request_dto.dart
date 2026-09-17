// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// PublicDeletionRequestDto, from the CareBridge API.
class PublicDeletionRequestDto {
  const PublicDeletionRequestDto({required this.email});

  /// Always accepted, whatever the address turns out to be. Whether an address
  /// has an account is a fact about a person, and for this product that person
  /// has a vulnerable relative.
  final String email;

  factory PublicDeletionRequestDto.fromJson(Map<String, dynamic> json) =>
      PublicDeletionRequestDto(email: json['email'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'email': email};
}
