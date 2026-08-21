// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DriverShiftDto, from the CareBridge API.
class DriverShiftDto {
  const DriverShiftDto({required this.onShift});

  /// A driver may take themselves on and off shift. The dispatcher can too —
  /// they are the one who hears about the flat tyre first.
  final bool onShift;

  factory DriverShiftDto.fromJson(Map<String, dynamic> json) =>
      DriverShiftDto(onShift: json['onShift'] as bool);

  Map<String, dynamic> toJson() => <String, dynamic>{'onShift': onShift};
}
