import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../domain/billing.dart';

/// Wire → domain, for the operator's side of the two-sided billing model.
///
/// Unknown enum values are **dropped**, never guessed at, and here that rule
/// is about money rather than about tidiness. An invoice rendered as "Paid"
/// because this build did not recognise `uncollectible` is a bill somebody
/// believes is settled; a plan rendered at the wrong interval is a price
/// somebody agrees to on the wrong cadence. A missing row is a question
/// somebody asks. The two failures are not comparable.

BillingLine _lineFromQuoteWire(wire.SubscriptionLineDto dto) => BillingLine(
  label: dto.label,
  quantity: dto.quantity,
  unitPriceCents: dto.unitPriceCents,
  amountCents: dto.amountCents,
);

BillingLine _lineFromInvoiceWire(wire.InvoiceLineDto dto) => BillingLine(
  label: dto.label,
  quantity: dto.quantity,
  unitPriceCents: dto.unitPriceCents,
  amountCents: dto.amountCents,
);

/// A renewal quote, or null when the interval is one this build cannot name.
BillingQuote? quoteFromWire(wire.SubscriptionQuoteDto? dto) {
  if (dto == null) return null;

  final interval = BillingInterval.tryParse(dto.interval.wireName);
  if (interval == null) return null;

  return BillingQuote(
    planCode: dto.planCode,
    interval: interval,
    seats: dto.seats,
    billableSeats: dto.billableSeats,
    lines: dto.lines.map(_lineFromQuoteWire).toList(),
    totalCents: dto.totalCents,
  );
}

/// A plan from the catalogue, filtered to the operator side by the caller.
OperatorPlan? planFromWire(wire.SubscriptionPlanDto dto) {
  final interval = BillingInterval.tryParse(dto.interval.wireName);
  if (interval == null) return null;

  return OperatorPlan(
    code: dto.code,
    version: dto.version,
    interval: interval,
    name: dto.name,
    description: dto.description,
    basePriceCents: dto.basePriceCents,
    includedSeats: dto.includedSeats,
    seatTiers: [
      for (final tier in dto.seatTiers)
        SeatTier(
          upToSeats: tier.upToSeats,
          unitPriceCents: tier.unitPriceCents,
        ),
    ],
    entitlements: List.unmodifiable(dto.entitlements),
    trialDays: dto.trialDays,
    graceDays: dto.graceDays,
  );
}

OperatorSubscription? subscriptionFromWire(wire.SubscriptionDto? dto) {
  if (dto == null) return null;

  final status = SubscriptionStatus.tryParse(dto.status.wireName);
  final interval = BillingInterval.tryParse(dto.interval.wireName);
  final renewal = quoteFromWire(dto.renewalQuote);
  if (status == null || interval == null || renewal == null) return null;

  return OperatorSubscription(
    id: dto.id,
    status: status,
    interval: interval,
    planCode: dto.planCode,
    planName: dto.planName,
    seats: dto.seats,
    currentPeriodStart: dto.currentPeriodStart,
    currentPeriodEnd: dto.currentPeriodEnd,
    entitlements: List.unmodifiable(dto.entitlements),
    renewalQuote: renewal,
    carriedCreditCents: dto.carriedCreditCents,
    trialEndsAt: dto.trialEndsAt,
    pastDueSince: dto.pastDueSince,
    cancelRequestedAt: dto.cancelRequestedAt,
  );
}

Invoice? invoiceFromWire(wire.InvoiceDto dto) {
  final reason = InvoiceReason.tryParse(dto.reason.wireName);
  final status = InvoiceStatus.tryParse(dto.status.wireName);
  if (reason == null || status == null) return null;

  return Invoice(
    id: dto.id,
    number: dto.number,
    reason: reason,
    status: status,
    subtotalCents: dto.subtotalCents,
    creditAppliedCents: dto.creditAppliedCents,
    totalCents: dto.totalCents,
    amountPaidCents: dto.amountPaidCents,
    lines: dto.lines.map(_lineFromInvoiceWire).toList(),
    issuedAt: dto.issuedAt,
    attemptCount: dto.attemptCount,
    paidAt: dto.paidAt,
    nextAttemptAt: dto.nextAttemptAt,
    lastFailureCode: dto.lastFailureCode,
  );
}

PaymentMethod? paymentMethodFromWire(wire.PaymentMethodDto? dto) {
  if (dto == null) return null;

  return PaymentMethod(
    id: dto.id,
    brand: dto.brand,
    last4: dto.last4,
    expMonth: dto.expMonth,
    expYear: dto.expYear,
    isDefault: dto.isDefault,
  );
}

/// The whole billing account.
///
/// A subscription this build cannot decode collapses to `null`, which the
/// screen renders as "no plan" — and that is the one place this codec is
/// deliberately imprecise. It is the safe direction: it offers a subscribe
/// control the server will either accept or refuse with a plain message,
/// rather than showing a plan whose status the console cannot name.
BillingAccount accountFromWire(wire.BillingAccountDto dto) => BillingAccount(
  id: dto.id,
  billingEmail: dto.billingEmail,
  amountDueCents: dto.amountDueCents,
  organizationId: dto.organizationId,
  subscription: subscriptionFromWire(dto.subscription),
  paymentMethod: paymentMethodFromWire(dto.paymentMethod),
);
