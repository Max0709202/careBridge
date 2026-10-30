// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DriverOnboardingDto, from the CareBridge API.
class DriverOnboardingDto {
  const DriverOnboardingDto({
    required this.email,
    required this.fullName,
    required this.emailVerified,
    required this.hasDriverProfile,
  });

  final String email;

  final String fullName;

  /// Applying needs a verified address, for the same reason the roster claim
  /// does.
  final bool emailVerified;

  /// Whether this account already has a driver profile, in which case the app
  /// should read /driver/me instead.
  final bool hasDriverProfile;

  factory DriverOnboardingDto.fromJson(Map<String, dynamic> json) =>
      DriverOnboardingDto(
        email: json['email'] as String,
        fullName: json['fullName'] as String,
        emailVerified: json['emailVerified'] as bool,
        hasDriverProfile: json['hasDriverProfile'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'email': email,
    'fullName': fullName,
    'emailVerified': emailVerified,
    'hasDriverProfile': hasDriverProfile,
  };
}
