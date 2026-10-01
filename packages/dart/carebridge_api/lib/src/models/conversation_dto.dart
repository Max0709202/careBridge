// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ConversationDto, from the CareBridge API.
class ConversationDto {
  const ConversationDto({
    required this.id,
    required this.kind,
    required this.organizationId,
    required this.organizationName,
    this.patientId,
    this.driverId,
    this.peerDriverId,
    this.rideId,
    required this.title,
    required this.myRole,
    required this.canPost,
    this.ride,
    this.lastMessage,
    this.lastMessageAt,
    required this.unreadCount,
  });

  final String id;

  final ConversationKind kind;

  final String organizationId;

  final String organizationName;

  final String? patientId;

  final String? driverId;

  final String? peerDriverId;

  final String? rideId;

  /// The other side, from the caller's point of view — "Meridian Transit
  /// dispatch" to a family, "Eleanor's family" to a dispatcher.
  final String title;

  final ConversationRole myRole;

  /// False for dispatch in a driver-to-driver thread, and for the family and
  /// driver once a finished ride's thread has closed.
  final bool canPost;

  final ConversationRideDto? ride;

  final MessageDto? lastMessage;

  final DateTime? lastMessageAt;

  final double unreadCount;

  factory ConversationDto.fromJson(Map<String, dynamic> json) => ConversationDto(
        id: json['id'] as String,
        kind: ConversationKind.fromJson(json['kind'] as String),
        organizationId: json['organizationId'] as String,
        organizationName: json['organizationName'] as String,
        patientId: json['patientId'] as String?,
        driverId: json['driverId'] as String?,
        peerDriverId: json['peerDriverId'] as String?,
        rideId: json['rideId'] as String?,
        title: json['title'] as String,
        myRole: ConversationRole.fromJson(json['myRole'] as String),
        canPost: json['canPost'] as bool,
        ride: json['ride'] == null ? null : ConversationRideDto.fromJson(json['ride'] as Map<String, dynamic>),
        lastMessage: json['lastMessage'] == null ? null : MessageDto.fromJson(json['lastMessage'] as Map<String, dynamic>),
        lastMessageAt: json['lastMessageAt'] == null ? null : DateTime.parse(json['lastMessageAt'] as String),
        unreadCount: (json['unreadCount'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'kind': kind.wireName,
        'organizationId': organizationId,
        'organizationName': organizationName,
        if (patientId != null) 'patientId': patientId,
        if (driverId != null) 'driverId': driverId,
        if (peerDriverId != null) 'peerDriverId': peerDriverId,
        if (rideId != null) 'rideId': rideId,
        'title': title,
        'myRole': myRole.wireName,
        'canPost': canPost,
        if (ride != null) 'ride': ride?.toJson(),
        if (lastMessage != null) 'lastMessage': lastMessage?.toJson(),
        if (lastMessageAt != null) 'lastMessageAt': lastMessageAt?.toIso8601String(),
        'unreadCount': unreadCount,
      };
}
