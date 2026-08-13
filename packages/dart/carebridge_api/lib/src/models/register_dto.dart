// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RegisterDto, from the CareBridge API.
class RegisterDto {
  const RegisterDto({
    required this.fullName,
    required this.email,
    required this.password,
    this.acceptedTerms,
    this.timeZone,
  });

  final String fullName;

  final String email;

  final String password;

  /// Records a terms and privacy consent. Consent is an explicit act, never
  /// inferred from use of the app.
  final bool? acceptedTerms;

  /// IANA zone. Reminder scheduling is computed in it, so "the evening before"
  /// means the user’s evening.
  final String? timeZone;

  factory RegisterDto.fromJson(Map<String, dynamic> json) => RegisterDto(
    fullName: json['fullName'] as String,
    email: json['email'] as String,
    password: json['password'] as String,
    acceptedTerms: json['acceptedTerms'] as bool?,
    timeZone: json['timeZone'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'fullName': fullName,
    'email': email,
    'password': password,
    if (acceptedTerms != null) 'acceptedTerms': acceptedTerms,
    if (timeZone != null) 'timeZone': timeZone,
  };
}
