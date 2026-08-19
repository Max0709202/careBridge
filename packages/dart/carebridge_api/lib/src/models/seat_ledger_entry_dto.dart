// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SeatLedgerEntryDto, from the CareBridge API.
class SeatLedgerEntryDto {
  const SeatLedgerEntryDto({
    required this.id,
    required this.driverId,
    required this.driverDisplayName,
    required this.change,
    required this.at,
    required this.seatsAfter,
    required this.prorationCents,
  });

  final String id;

  final String driverId;

  final String driverDisplayName;

  final SeatChange change;

  final DateTime at;

  final int seatsAfter;

  /// Charged immediately for the remainder of the period on a grant. Zero on a
  /// release — a released seat stays usable until the period that paid for it
  /// ends.
  final int prorationCents;

  factory SeatLedgerEntryDto.fromJson(Map<String, dynamic> json) =>
      SeatLedgerEntryDto(
        id: json['id'] as String,
        driverId: json['driverId'] as String,
        driverDisplayName: json['driverDisplayName'] as String,
        change: SeatChange.fromJson(json['change'] as String),
        at: DateTime.parse(json['at'] as String),
        seatsAfter: json['seatsAfter'] as int,
        prorationCents: json['prorationCents'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'driverId': driverId,
    'driverDisplayName': driverDisplayName,
    'change': change.wireName,
    'at': at.toIso8601String(),
    'seatsAfter': seatsAfter,
    'prorationCents': prorationCents,
  };
}
