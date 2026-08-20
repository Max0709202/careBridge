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

  /// What this household has been billed
  ///
  /// Newest first. Line items are read back from the invoice, not recomputed —
  /// a superseded plan must not reprint last March at this March’s prices.
  Future<List<InvoiceDto>> invoices() async {
    final response = await _client.send(
      method: 'GET',
      path: '/billing/invoices',
    );
    return (response as List<dynamic>)
        .map((e) => InvoiceDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Put a card on file
  ///
  /// Takes a token the client obtained directly from the processor. No endpoint
  /// in this system accepts a card number — see ADR-0006.
  Future<PaymentMethodDto> attachPaymentMethod({
    required AttachPaymentMethodDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/billing/payment-method',
      body: body.toJson(),
    );
    return PaymentMethodDto.fromJson(response as Map<String, dynamic>);
  }

  /// Take a card off file
  ///
  /// The row is kept and marked detached, so a payment made months ago still
  /// names the card that made it. Removing the last card is allowed.
  Future<void> detachPaymentMethod({required String id}) async {
    await _client.send(
      method: 'DELETE',
      path: '/billing/payment-method/${Uri.encodeComponent(id)}',
    );
    return;
  }

  /// Charge an open invoice now
  ///
  /// For the moment after a declined card is replaced: waiting a day for the
  /// scheduled retry, while the screen still says the payment failed, reads as
  /// the update not having worked.
  Future<InvoiceDto> payInvoice({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/billing/invoices/${Uri.encodeComponent(id)}/pay',
    );
    return InvoiceDto.fromJson(response as Map<String, dynamic>);
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
