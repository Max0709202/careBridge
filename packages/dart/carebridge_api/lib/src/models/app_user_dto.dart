// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AppUserDto, from the CareBridge API.
class AppUserDto {
  const AppUserDto({
    required this.id,
    required this.email,
    required this.fullName,
    this.phone,
    this.emailVerifiedAt,
    required this.timeZone,
  });

  final String id;

  final String email;

  final String fullName;

  final String? phone;

  /// Null until the address is proven. Nothing is blocked on it except issuing
  /// and accepting invitations — but the app needs the fact to prompt, and a
  /// prompt is the only reason an unverified address ever gets verified.
  final DateTime? emailVerifiedAt;

  /// IANA zone. Reminder scheduling for this user is computed in it.
  final String timeZone;

  factory AppUserDto.fromJson(Map<String, dynamic> json) => AppUserDto(
    id: json['id'] as String,
    email: json['email'] as String,
    fullName: json['fullName'] as String,
    phone: json['phone'] as String?,
    emailVerifiedAt: json['emailVerifiedAt'] == null
        ? null
        : DateTime.parse(json['emailVerifiedAt'] as String),
    timeZone: json['timeZone'] as String,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'email': email,
    'fullName': fullName,
    if (phone != null) 'phone': phone,
    if (emailVerifiedAt != null)
      'emailVerifiedAt': emailVerifiedAt?.toIso8601String(),
    'timeZone': timeZone,
  };
}
