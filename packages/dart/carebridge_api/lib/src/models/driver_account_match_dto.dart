// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DriverAccountMatchDto, from the CareBridge API.
class DriverAccountMatchDto {
  const DriverAccountMatchDto({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.suggestedDisplayName,
  });

  final String userId;

  final String fullName;

  final String email;

  /// First name and last initial, for the roster. The operator may change it.
  final String suggestedDisplayName;

  factory DriverAccountMatchDto.fromJson(Map<String, dynamic> json) =>
      DriverAccountMatchDto(
        userId: json['userId'] as String,
        fullName: json['fullName'] as String,
        email: json['email'] as String,
        suggestedDisplayName: json['suggestedDisplayName'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'userId': userId,
    'fullName': fullName,
    'email': email,
    'suggestedDisplayName': suggestedDisplayName,
  };
}
