// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DispatchQueueDto, from the CareBridge API.
class DispatchQueueDto {
  const DispatchQueueDto({
    required this.organizationId,
    required this.items,
    required this.availableDrivers,
  });

  final String organizationId;

  final List<DispatchQueueItemDto> items;

  /// Drivers on shift and free right now, across the whole roster.
  final int availableDrivers;

  factory DispatchQueueDto.fromJson(Map<String, dynamic> json) =>
      DispatchQueueDto(
        organizationId: json['organizationId'] as String,
        items: (json['items'] as List<dynamic>)
            .map(
              (e) => DispatchQueueItemDto.fromJson(e as Map<String, dynamic>),
            )
            .toList(),
        availableDrivers: json['availableDrivers'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'organizationId': organizationId,
    'items': items.map((e) => e.toJson()).toList(),
    'availableDrivers': availableDrivers,
  };
}
