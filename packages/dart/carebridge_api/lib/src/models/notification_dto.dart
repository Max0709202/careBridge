// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// NotificationDto, from the CareBridge API.
class NotificationDto {
  const NotificationDto({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.rideId,
    this.appointmentId,
  });

  final String id;

  final String kind;

  /// Carries no patient name, clinic name, address or time. A phone on a
  /// kitchen table is readable by whoever is in the room.
  final String title;

  final String body;

  final DateTime createdAt;

  final DateTime? readAt;

  final String? rideId;

  final String? appointmentId;

  factory NotificationDto.fromJson(Map<String, dynamic> json) =>
      NotificationDto(
        id: json['id'] as String,
        kind: json['kind'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        readAt: json['readAt'] == null
            ? null
            : DateTime.parse(json['readAt'] as String),
        rideId: json['rideId'] as String?,
        appointmentId: json['appointmentId'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'kind': kind,
    'title': title,
    'body': body,
    'createdAt': createdAt.toIso8601String(),
    if (readAt != null) 'readAt': readAt?.toIso8601String(),
    if (rideId != null) 'rideId': rideId,
    if (appointmentId != null) 'appointmentId': appointmentId,
  };
}
