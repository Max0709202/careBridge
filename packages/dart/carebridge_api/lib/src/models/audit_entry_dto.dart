// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AuditEntryDto, from the CareBridge API.
class AuditEntryDto {
  const AuditEntryDto({
    required this.id,
    required this.at,
    this.actorUserId,
    this.actorName,
    required this.action,
    required this.entityType,
    this.entityId,
    required this.changedFields,
    this.correlationId,
    this.ip,
  });

  final String id;

  final DateTime at;

  final String? actorUserId;

  /// The actor’s name, resolved for display. Absent for actions the system took
  /// on its own.
  final String? actorName;

  final String action;

  final String entityType;

  final String? entityId;

  /// Field **names** only, never values — the whole reason this log can be read
  /// by somebody who may not read the records it describes.
  final List<String> changedFields;

  final String? correlationId;

  final String? ip;

  factory AuditEntryDto.fromJson(Map<String, dynamic> json) => AuditEntryDto(
    id: json['id'] as String,
    at: DateTime.parse(json['at'] as String),
    actorUserId: json['actorUserId'] as String?,
    actorName: json['actorName'] as String?,
    action: json['action'] as String,
    entityType: json['entityType'] as String,
    entityId: json['entityId'] as String?,
    changedFields: (json['changedFields'] as List<dynamic>)
        .map((e) => e as String)
        .toList(),
    correlationId: json['correlationId'] as String?,
    ip: json['ip'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'at': at.toIso8601String(),
    if (actorUserId != null) 'actorUserId': actorUserId,
    if (actorName != null) 'actorName': actorName,
    'action': action,
    'entityType': entityType,
    if (entityId != null) 'entityId': entityId,
    'changedFields': changedFields.map((e) => e).toList(),
    if (correlationId != null) 'correlationId': correlationId,
    if (ip != null) 'ip': ip,
  };
}
