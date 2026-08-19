// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "billing".
class BillingApi {
  const BillingApi(this._client);

  final CareBridgeApiClient _client;

  /// The plan catalogue
  ///
  /// Plans are rows, resolved server-side. The app renders what it is told — a
  /// price change or a new tier is an insert, not a release.
  Future<List<SubscriptionPlanDto>> plans({Payer? payer}) async {
    final query = <String, String>{
      if (payer != null) 'payer': payer.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/billing/plans',
      query: query,
    );
    return (response as List<dynamic>)
        .map((e) => SubscriptionPlanDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// The caller's household subscription
  Future<BillingAccountDto> account() async {
    final response = await _client.send(
      method: 'GET',
      path: '/billing/account',
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Start a household subscription
  ///
  /// Refused if one is already live — changing plan is `change-interval`, and
  /// anything else is two intentions sharing an endpoint.
  Future<BillingAccountDto> subscribe({required SubscribeDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/billing/subscribe',
      body: body.toJson(),
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Move between monthly and annual
  ///
  /// The unused remainder of the current period is credited and a fresh period
  /// starts today. Annual → monthly leaves a credit carried against renewals,
  /// not a refund.
  Future<BillingAccountDto> changeInterval({
    required ChangeIntervalDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/billing/change-interval',
      body: body.toJson(),
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }

  /// Cancel at the end of the paid period
  ///
  /// Not a refund and not an immediate switch-off: a family part-way through a
  /// booked month keeps live tracking for the rides they have already arranged.
  Future<BillingAccountDto> cancel() async {
    final response = await _client.send(
      method: 'POST',
      path: '/billing/cancel',
    );
    return BillingAccountDto.fromJson(response as Map<String, dynamic>);
  }
}
