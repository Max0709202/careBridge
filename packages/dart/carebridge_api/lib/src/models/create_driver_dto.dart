// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CreateDriverDto, from the CareBridge API.
class CreateDriverDto {
  const CreateDriverDto({
    required this.displayName,
    required this.vehicleId,
    this.yearsDriving,
  });

  /// First name and last initial. Never a full legal name.
  final String displayName;

  final String vehicleId;

  final double? yearsDriving;

  factory CreateDriverDto.fromJson(Map<String, dynamic> json) =>
      CreateDriverDto(
        displayName: json['displayName'] as String,
        vehicleId: json['vehicleId'] as String,
        yearsDriving: json['yearsDriving'] == null
            ? null
            : (json['yearsDriving'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'displayName': displayName,
    'vehicleId': vehicleId,
    if (yearsDriving != null) 'yearsDriving': yearsDriving,
  };
}
