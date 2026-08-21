// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// BookingDto, from the CareBridge API.
class BookingDto {
  const BookingDto({
    required this.id,
    required this.caregiverId,
    required this.caregiverName,
    required this.patientId,
    required this.patientName,
    required this.startsAt,
    required this.endsAt,
    required this.status,
    required this.hourlyRateCents,
    this.checkedInAt,
    this.checkedOutAt,
    this.billableMinutes,
    this.totalCents,
    this.caregiverPayoutCents,
    this.cancellationReason,
    required this.hasReview,
    required this.hasOpenDispute,
  });

  final String id;

  final String caregiverId;

  final String caregiverName;

  final String patientId;

  final String patientName;

  final DateTime startsAt;

  final DateTime endsAt;

  final BookingStatus status;

  /// The rate agreed at booking, not today’s. A caregiver raising their price
  /// must not re-price work somebody has already agreed to.
  final int hourlyRateCents;

  final DateTime? checkedInAt;

  final DateTime? checkedOutAt;

  final int? billableMinutes;

  final int? totalCents;

  /// What the caregiver keeps. Derived by subtraction, so the two halves always
  /// add up.
  final int? caregiverPayoutCents;

  final String? cancellationReason;

  final bool hasReview;

  final bool hasOpenDispute;

  factory BookingDto.fromJson(Map<String, dynamic> json) => BookingDto(
    id: json['id'] as String,
    caregiverId: json['caregiverId'] as String,
    caregiverName: json['caregiverName'] as String,
    patientId: json['patientId'] as String,
    patientName: json['patientName'] as String,
    startsAt: DateTime.parse(json['startsAt'] as String),
    endsAt: DateTime.parse(json['endsAt'] as String),
    status: BookingStatus.fromJson(json['status'] as String),
    hourlyRateCents: json['hourlyRateCents'] as int,
    checkedInAt: json['checkedInAt'] == null
        ? null
        : DateTime.parse(json['checkedInAt'] as String),
    checkedOutAt: json['checkedOutAt'] == null
        ? null
        : DateTime.parse(json['checkedOutAt'] as String),
    billableMinutes: json['billableMinutes'] as int?,
    totalCents: json['totalCents'] as int?,
    caregiverPayoutCents: json['caregiverPayoutCents'] as int?,
    cancellationReason: json['cancellationReason'] as String?,
    hasReview: json['hasReview'] as bool,
    hasOpenDispute: json['hasOpenDispute'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'caregiverId': caregiverId,
    'caregiverName': caregiverName,
    'patientId': patientId,
    'patientName': patientName,
    'startsAt': startsAt.toIso8601String(),
    'endsAt': endsAt.toIso8601String(),
    'status': status.wireName,
    'hourlyRateCents': hourlyRateCents,
    if (checkedInAt != null) 'checkedInAt': checkedInAt?.toIso8601String(),
    if (checkedOutAt != null) 'checkedOutAt': checkedOutAt?.toIso8601String(),
    if (billableMinutes != null) 'billableMinutes': billableMinutes,
    if (totalCents != null) 'totalCents': totalCents,
    if (caregiverPayoutCents != null)
      'caregiverPayoutCents': caregiverPayoutCents,
    if (cancellationReason != null) 'cancellationReason': cancellationReason,
    'hasReview': hasReview,
    'hasOpenDispute': hasOpenDispute,
  };
}
