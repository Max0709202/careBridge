// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AssignRideDto, from the CareBridge API.
class AssignRideDto {
  const AssignRideDto({required this.driverId, this.reason});

  final String driverId;

  /// Required when taking a ride off a driver who already had it.
  final String? reason;

  factory AssignRideDto.fromJson(Map<String, dynamic> json) => AssignRideDto(
    driverId: json['driverId'] as String,
    reason: json['reason'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'driverId': driverId,
    if (reason != null) 'reason': reason,
  };
}
