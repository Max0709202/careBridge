// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ClinicDayDto, from the CareBridge API.
class ClinicDayDto {
  const ClinicDayDto({
    required this.date,
    required this.arrivals,
    required this.waitingForReturn,
    required this.overdueReturns,
  });

  /// The clinic-local date, ISO.
  final String date;

  final List<ExpectedArrivalDto> arrivals;

  /// Patients the clinic has said are ready, still waiting for a car.
  final int waitingForReturn;

  final int overdueReturns;

  factory ClinicDayDto.fromJson(Map<String, dynamic> json) => ClinicDayDto(
    date: json['date'] as String,
    arrivals: (json['arrivals'] as List<dynamic>)
        .map((e) => ExpectedArrivalDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    waitingForReturn: json['waitingForReturn'] as int,
    overdueReturns: json['overdueReturns'] as int,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'date': date,
    'arrivals': arrivals.map((e) => e.toJson()).toList(),
    'waitingForReturn': waitingForReturn,
    'overdueReturns': overdueReturns,
  };
}
