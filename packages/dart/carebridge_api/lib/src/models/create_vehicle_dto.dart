// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CreateVehicleDto, from the CareBridge API.
class CreateVehicleDto {
  const CreateVehicleDto({
    required this.make,
    required this.model,
    required this.color,
    required this.licensePlate,
    required this.isWheelchairAccessible,
  });

  final String make;

  final String model;

  final String color;

  final String licensePlate;

  final bool isWheelchairAccessible;

  factory CreateVehicleDto.fromJson(Map<String, dynamic> json) =>
      CreateVehicleDto(
        make: json['make'] as String,
        model: json['model'] as String,
        color: json['color'] as String,
        licensePlate: json['licensePlate'] as String,
        isWheelchairAccessible: json['isWheelchairAccessible'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'make': make,
    'model': model,
    'color': color,
    'licensePlate': licensePlate,
    'isWheelchairAccessible': isWheelchairAccessible,
  };
}
