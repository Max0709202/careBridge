// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// LoginDto, from the CareBridge API.
class LoginDto {
  const LoginDto({required this.email, required this.password, this.mfaCode});

  final String email;

  final String password;

  /// Six-digit authenticator code, or a recovery code. Required only for
  /// accounts with two-factor authentication confirmed.
  final String? mfaCode;

  factory LoginDto.fromJson(Map<String, dynamic> json) => LoginDto(
    email: json['email'] as String,
    password: json['password'] as String,
    mfaCode: json['mfaCode'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'email': email,
    'password': password,
    if (mfaCode != null) 'mfaCode': mfaCode,
  };
}
