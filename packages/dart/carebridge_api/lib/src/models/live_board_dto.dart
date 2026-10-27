// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// LiveBoardDto, from the CareBridge API.
class LiveBoardDto {
  const LiveBoardDto({
    required this.organizationId,
    this.serviceArea,
    required this.rides,
  });

  final String organizationId;

  final ServiceAreaDto? serviceArea;

  final List<LiveRideDto> rides;

  factory LiveBoardDto.fromJson(Map<String, dynamic> json) => LiveBoardDto(
    organizationId: json['organizationId'] as String,
    serviceArea: json['serviceArea'] == null
        ? null
        : ServiceAreaDto.fromJson(json['serviceArea'] as Map<String, dynamic>),
    rides: (json['rides'] as List<dynamic>)
        .map((e) => LiveRideDto.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'organizationId': organizationId,
    if (serviceArea != null) 'serviceArea': serviceArea?.toJson(),
    'rides': rides.map((e) => e.toJson()).toList(),
  };
}
