// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ColleagueDto, from the CareBridge API.
class ColleagueDto {
  const ColleagueDto({
    required this.driverId,
    required this.displayName,
    required this.onShift,
  });

  final String driverId;

  final String displayName;

  final bool onShift;

  factory ColleagueDto.fromJson(Map<String, dynamic> json) => ColleagueDto(
    driverId: json['driverId'] as String,
    displayName: json['displayName'] as String,
    onShift: json['onShift'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'driverId': driverId,
    'displayName': displayName,
    'onShift': onShift,
  };
}
