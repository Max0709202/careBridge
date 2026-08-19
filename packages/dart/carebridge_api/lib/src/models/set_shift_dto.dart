// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SetShiftDto, from the CareBridge API.
class SetShiftDto {
  const SetShiftDto({required this.onShift});

  final bool onShift;

  factory SetShiftDto.fromJson(Map<String, dynamic> json) =>
      SetShiftDto(onShift: json['onShift'] as bool);

  Map<String, dynamic> toJson() => <String, dynamic>{'onShift': onShift};
}
