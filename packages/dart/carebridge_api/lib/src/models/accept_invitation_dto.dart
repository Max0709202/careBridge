// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AcceptInvitationDto, from the CareBridge API.
class AcceptInvitationDto {
  const AcceptInvitationDto({required this.token});

  /// The single-use token from the invitation link.
  final String token;

  factory AcceptInvitationDto.fromJson(Map<String, dynamic> json) =>
      AcceptInvitationDto(token: json['token'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'token': token};
}
