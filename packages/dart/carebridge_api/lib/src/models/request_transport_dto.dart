// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RequestTransportDto, from the CareBridge API.
class RequestTransportDto {
  const RequestTransportDto({
    required this.appointmentId,
    required this.pickupAt,
    required this.roundTrip,
    this.notesForDriver,
  });

  final String appointmentId;

  final DateTime pickupAt;

  /// A round trip produces **two rides** sharing a group id, not one ride with
  /// two legs: each is assigned, tracked, cancelled and priced independently.
  final bool roundTrip;

  final String? notesForDriver;

  factory RequestTransportDto.fromJson(Map<String, dynamic> json) =>
      RequestTransportDto(
        appointmentId: json['appointmentId'] as String,
        pickupAt: DateTime.parse(json['pickupAt'] as String),
        roundTrip: json['roundTrip'] as bool,
        notesForDriver: json['notesForDriver'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'appointmentId': appointmentId,
    'pickupAt': pickupAt.toIso8601String(),
    'roundTrip': roundTrip,
    if (notesForDriver != null) 'notesForDriver': notesForDriver,
  };
}
