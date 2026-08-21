// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverDto, from the CareBridge API.
class DriverDto {
  const DriverDto({
    required this.id,
    required this.displayName,
    required this.status,
    required this.onShift,
    required this.rating,
    required this.yearsDriving,
    required this.vehicle,
    this.approvedAt,
    this.suspensionReason,
    required this.occupiesSeat,
    required this.activeRideCount,
    this.invitedEmail,
    required this.hasAppAccount,
  });

  final String id;

  /// First name and last initial only. The family needs to recognise the person
  /// at the kerb, not to be able to look them up.
  final String displayName;

  final DriverStatus status;

  /// Working right now. Separate from status, which is whether the company has
  /// said this person may carry a passenger at all.
  final bool onShift;

  final double rating;

  final int yearsDriving;

  final VehicleDto vehicle;

  final DateTime? approvedAt;

  final String? suspensionReason;

  /// Whether this driver counts towards the operator’s per-driver subscription.
  /// True for approved drivers and nobody else.
  final bool occupiesSeat;

  final int activeRideCount;

  /// The address this driver will sign into the driver app with, as recorded by
  /// the operator.
  final String? invitedEmail;

  /// Whether the driver has actually opened the app and claimed this roster
  /// place. A roster full of approved drivers who have never signed in is a
  /// shift nobody will answer for.
  final bool hasAppAccount;

  factory DriverDto.fromJson(Map<String, dynamic> json) => DriverDto(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    status: DriverStatus.fromJson(json['status'] as String),
    onShift: json['onShift'] as bool,
    rating: (json['rating'] as num).toDouble(),
    yearsDriving: json['yearsDriving'] as int,
    vehicle: VehicleDto.fromJson(json['vehicle'] as Map<String, dynamic>),
    approvedAt: json['approvedAt'] == null
        ? null
        : DateTime.parse(json['approvedAt'] as String),
    suspensionReason: json['suspensionReason'] as String?,
    occupiesSeat: json['occupiesSeat'] as bool,
    activeRideCount: json['activeRideCount'] as int,
    invitedEmail: json['invitedEmail'] as String?,
    hasAppAccount: json['hasAppAccount'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'displayName': displayName,
    'status': status.wireName,
    'onShift': onShift,
    'rating': rating,
    'yearsDriving': yearsDriving,
    'vehicle': vehicle.toJson(),
    if (approvedAt != null) 'approvedAt': approvedAt?.toIso8601String(),
    if (suspensionReason != null) 'suspensionReason': suspensionReason,
    'occupiesSeat': occupiesSeat,
    'activeRideCount': activeRideCount,
    if (invitedEmail != null) 'invitedEmail': invitedEmail,
    'hasAppAccount': hasAppAccount,
  };
}
