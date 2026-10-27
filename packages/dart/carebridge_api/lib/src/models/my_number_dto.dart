// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// MyNumberDto, from the CareBridge API.
class MyNumberDto {
  const MyNumberDto({this.phone});

  /// E.164, or null if none is set.
  final String? phone;

  factory MyNumberDto.fromJson(Map<String, dynamic> json) =>
      MyNumberDto(phone: json['phone'] as String?);

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (phone != null) 'phone': phone,
  };
}
