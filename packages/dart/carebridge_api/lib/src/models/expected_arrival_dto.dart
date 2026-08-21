// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ExpectedArrivalDto, from the CareBridge API.
class ExpectedArrivalDto {
  const ExpectedArrivalDto({
    required this.appointmentId,
    required this.clinicId,
    required this.clinicName,
    required this.patientName,
    required this.startsAt,
    required this.appointmentType,
    required this.stage,
    this.outboundStatus,
    this.returnStatus,
    this.etaMinutes,
    this.driverName,
    this.vehicleDescription,
    required this.wheelchairRequired,
    this.checkedInAt,
    this.readyForReturnAt,
    this.waitingMinutes,
    required this.overdue,
    required this.canDispatchReturn,
    this.cannotDispatchReason,
  });

  final String appointmentId;

  final String clinicId;

  final String clinicName;

  /// The name the family uses. Never a full legal name.
  final String patientName;

  final DateTime startsAt;

  final String appointmentType;

  /// Checking in is deliberately **not** inferred from the ride completing. A
  /// completed ride says a car reached an address; a check-in says somebody
  /// inside the building saw the patient, and the gap between the two is the
  /// case this product exists for.
  final ExpectedArrivalDtoStage stage;

  final String? outboundStatus;

  final String? returnStatus;

  /// Minutes until the car arrives, when one is on its way.
  final int? etaMinutes;

  final String? driverName;

  final String? vehicleDescription;

  final bool wheelchairRequired;

  final DateTime? checkedInAt;

  final DateTime? readyForReturnAt;

  /// How long since the clinic said the visit was over. Shown because the
  /// person who pressed the button is standing next to somebody in a coat by
  /// the door.
  final int? waitingMinutes;

  /// The wait has stopped being ordinary. Twenty-five minutes.
  final bool overdue;

  /// Whether the “send a car home” button should do anything.
  final bool canDispatchReturn;

  final String? cannotDispatchReason;

  factory ExpectedArrivalDto.fromJson(Map<String, dynamic> json) =>
      ExpectedArrivalDto(
        appointmentId: json['appointmentId'] as String,
        clinicId: json['clinicId'] as String,
        clinicName: json['clinicName'] as String,
        patientName: json['patientName'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        appointmentType: json['appointmentType'] as String,
        stage: ExpectedArrivalDtoStage.fromJson(json['stage'] as String),
        outboundStatus: json['outboundStatus'] as String?,
        returnStatus: json['returnStatus'] as String?,
        etaMinutes: json['etaMinutes'] as int?,
        driverName: json['driverName'] as String?,
        vehicleDescription: json['vehicleDescription'] as String?,
        wheelchairRequired: json['wheelchairRequired'] as bool,
        checkedInAt: json['checkedInAt'] == null
            ? null
            : DateTime.parse(json['checkedInAt'] as String),
        readyForReturnAt: json['readyForReturnAt'] == null
            ? null
            : DateTime.parse(json['readyForReturnAt'] as String),
        waitingMinutes: json['waitingMinutes'] as int?,
        overdue: json['overdue'] as bool,
        canDispatchReturn: json['canDispatchReturn'] as bool,
        cannotDispatchReason: json['cannotDispatchReason'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'appointmentId': appointmentId,
    'clinicId': clinicId,
    'clinicName': clinicName,
    'patientName': patientName,
    'startsAt': startsAt.toIso8601String(),
    'appointmentType': appointmentType,
    'stage': stage.wireName,
    if (outboundStatus != null) 'outboundStatus': outboundStatus,
    if (returnStatus != null) 'returnStatus': returnStatus,
    if (etaMinutes != null) 'etaMinutes': etaMinutes,
    if (driverName != null) 'driverName': driverName,
    if (vehicleDescription != null) 'vehicleDescription': vehicleDescription,
    'wheelchairRequired': wheelchairRequired,
    if (checkedInAt != null) 'checkedInAt': checkedInAt?.toIso8601String(),
    if (readyForReturnAt != null)
      'readyForReturnAt': readyForReturnAt?.toIso8601String(),
    if (waitingMinutes != null) 'waitingMinutes': waitingMinutes,
    'overdue': overdue,
    'canDispatchReturn': canDispatchReturn,
    if (cannotDispatchReason != null)
      'cannotDispatchReason': cannotDispatchReason,
  };
}
