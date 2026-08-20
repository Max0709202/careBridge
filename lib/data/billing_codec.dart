import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../core/money.dart';
import '../domain/billing.dart';
import '../domain/invoicing.dart';
import '../domain/subscription_pricing.dart';

/// Wire → domain, for the two things a family can be shown about what they pay.
///
/// Kept out of `lib/domain/` because the domain must not know the wire exists:
/// the moment it imports a generated DTO, it stops being a model of the rules
/// and starts being a model of one API version.
///
/// Unknown enum values are **dropped**, never guessed at. A client that invents
/// an entitlement offers a control the server then refuses, which reads to the
/// user as the app being broken rather than as their plan having lapsed.
Subscription? subscriptionFromWire(wire.SubscriptionDto? dto) {
  if (dto == null) return null;

  final payer = BillingPayer.tryParse(dto.payer.wireName);
  final status = SubscriptionStatus.tryParse(dto.status.wireName);
  final interval = BillingInterval.tryParse(dto.interval.wireName);
  if (payer == null || status == null || interval == null) return null;

  return Subscription(
    id: dto.id,
    payer: payer,
    status: status,
    interval: interval,
    planCode: dto.planCode,
    planName: dto.planName,
    planVersion: dto.planVersion,
    seats: dto.seats,
    currentPeriodStart: dto.currentPeriodStart,
    currentPeriodEnd: dto.currentPeriodEnd,
    trialEndsAt: dto.trialEndsAt,
    pastDueSince: dto.pastDueSince,
    cancelRequestedAt: dto.cancelRequestedAt,
    entitlements: {
      for (final raw in dto.entitlements) ?Entitlement.tryParse(raw),
    },
    renewalTotalCents: dto.renewalQuote.totalCents,
    carriedCreditCents: dto.carriedCreditCents,
  );
}

SubscriptionPlan? planFromWire(wire.SubscriptionPlanDto dto) {
  final payer = BillingPayer.tryParse(dto.payer.wireName);
  final interval = BillingInterval.tryParse(dto.interval.wireName);
  if (payer == null || interval == null) return null;

  return SubscriptionPlan(
    code: dto.code,
    version: dto.version,
    payer: payer,
    interval: interval,
    name: dto.name,
    description: dto.description,
    basePrice: Money(dto.basePriceCents),
    includedSeats: dto.includedSeats,
    seatTiers: [
      for (final tier in dto.seatTiers)
        SeatTier(
          upToSeats: tier.upToSeats,
          unitPriceCents: tier.unitPriceCents,
        ),
    ],
    entitlements: {
      for (final raw in dto.entitlements) ?Entitlement.tryParse(raw),
    },
    trialDays: dto.trialDays,
    graceDays: dto.graceDays,
  );
}

/// An invoice, wire → domain.
///
/// Returns null on an unrecognised status or reason rather than substituting a
/// plausible one. An invoice rendered as "Paid" because the client did not
/// recognise `uncollectible` is worse than an invoice that does not appear:
/// one is a missing row somebody asks about, the other is a bill somebody
/// believes is settled.
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
    lines: [
      for (final line in dto.lines)
        InvoiceLine(
          label: line.label,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          amountCents: line.amountCents,
        ),
    ],
    issuedAt: dto.issuedAt,
    paidAt: dto.paidAt,
    attemptCount: dto.attemptCount,
    nextAttemptAt: dto.nextAttemptAt,
    lastFailureCode: dto.lastFailureCode,
  );
}

/// The card on file. Four digits and a brand — there is no card number
/// anywhere in this system to decode.
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
