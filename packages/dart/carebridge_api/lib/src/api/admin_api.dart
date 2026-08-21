// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "admin".
class AdminApi {
  const AdminApi(this._client);

  final CareBridgeApiClient _client;

  /// The audit log, filtered and paged
  ///
  /// Keyset paged. An offset over a table appended to on every authenticated
  /// action would skip rows between pages — and quietly omitting rows is the
  /// one failure a log like this cannot have.
  Future<AuditPageDto> auditLog({
    String? actorUserId,
    String? entityType,
    String? entityId,
    String? action,
    DateTime? from,
    DateTime? to,
    String? cursor,
  }) async {
    final query = <String, String>{
      if (actorUserId != null) 'actorUserId': actorUserId.toString(),
      if (entityType != null) 'entityType': entityType.toString(),
      if (entityId != null) 'entityId': entityId.toString(),
      if (action != null) 'action': action.toString(),
      if (from != null) 'from': from.toString(),
      if (to != null) 'to': to.toString(),
      if (cursor != null) 'cursor': cursor.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/admin/audit',
      query: query,
    );
    return AuditPageDto.fromJson(response as Map<String, dynamic>);
  }

  /// The operational dashboard
  ///
  /// Each number implies an action rather than being interesting. “Stale
  /// tracking now” is a list of telephone calls; “drivers with expiring
  /// documents” is a list of drivers who come off the road unless somebody
  /// chases them.
  Future<PlatformStatsDto> stats() async {
    final response = await _client.send(method: 'GET', path: '/admin/stats');
    return PlatformStatsDto.fromJson(response as Map<String, dynamic>);
  }

  /// Every feature flag and how far it is rolled out
  Future<List<FeatureFlagDto>> flags() async {
    final response = await _client.send(method: 'GET', path: '/admin/flags');
    return (response as List<dynamic>)
        .map((e) => FeatureFlagDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Create or update a flag
  ///
  /// Narrowing a rollout needs `confirmNarrowing`: it takes a feature away from
  /// people who already have it, which reads to them as a bug rather than as a
  /// decision.
  Future<List<FeatureFlagDto>> setFlag({
    required String key,
    required SetFeatureFlagDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/admin/flags/${Uri.encodeComponent(key)}',
      body: body.toJson(),
    );
    return (response as List<dynamic>)
        .map((e) => FeatureFlagDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// What may still be refunded, and what already was
  Future<RefundableInvoiceDto> refundable({required String invoiceId}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/admin/invoices/${Uri.encodeComponent(invoiceId)}/refunds',
    );
    return RefundableInvoiceDto.fromJson(response as Map<String, dynamic>);
  }

  /// Send money back
  ///
  /// The row is written before the processor is called, in the same shape the
  /// collection path uses: a refund that succeeded externally and failed to
  /// record here would be money that left the business with nothing to explain
  /// it.
  Future<RefundableInvoiceDto> issueRefund({
    required String invoiceId,
    required IssueRefundDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/admin/invoices/${Uri.encodeComponent(invoiceId)}/refunds',
      body: body.toJson(),
    );
    return RefundableInvoiceDto.fromJson(response as Map<String, dynamic>);
  }
}
