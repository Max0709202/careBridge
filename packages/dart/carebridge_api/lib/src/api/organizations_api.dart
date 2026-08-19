// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "organizations".
class OrganizationsApi {
  const OrganizationsApi(this._client);

  final CareBridgeApiClient _client;

  /// Organisations the caller belongs to
  Future<List<OrganizationDto>> mine() async {
    final response = await _client.send(method: 'GET', path: '/organizations');
    return (response as List<dynamic>)
        .map((e) => OrganizationDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// An operator's subscription
  Future<BillingAccountDto> organizationBilling({required String id}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(id)}/billing',
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Start an operator subscription
  ///
  /// Priced at the drivers actually on the road — an operator cannot subscribe
  /// at five seats and run twenty.
  Future<BillingAccountDto> subscribeOrganization({
    required String id,
    required SubscribeDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/organizations/${Uri.encodeComponent(id)}/billing/subscribe',
      body: body.toJson(),
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Move an operator between monthly and annual
  Future<BillingAccountDto> changeOrganizationInterval({
    required String id,
    required ChangeIntervalDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/organizations/${Uri.encodeComponent(id)}/billing/change-interval',
      body: body.toJson(),
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Cancel an operator subscription at period end
  Future<BillingAccountDto> cancelOrganization({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/organizations/${Uri.encodeComponent(id)}/billing/cancel',
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Drivers, seats and the ledger behind them
  ///
  /// The audit trail an invoice line is answerable from: without it, "why were
  /// we billed for eleven drivers" can only be answered from a driver table
  /// that has since changed.
  Future<OrganizationSeatsDto> seats({required String id}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(id)}/seats',
    );
    return OrganizationSeatsDto.fromJson(response as Map<String, dynamic>);
  }

  /// What a given driver count would cost
  Future<SubscriptionQuoteDto> quote({
    required String id,
    String? planCode,
    Interval? interval,
    double? seats,
  }) async {
    final query = <String, String>{
      if (planCode != null) 'planCode': planCode.toString(),
      if (interval != null) 'interval': interval.toString(),
      if (seats != null) 'seats': seats.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(id)}/seats/quote',
      query: query,
    );
    return SubscriptionQuoteDto.fromJson(response as Map<String, dynamic>);
  }
}
