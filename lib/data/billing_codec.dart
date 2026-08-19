import 'package:carebridge_api/carebridge_api.dart' as wire;

import '../core/money.dart';
import '../domain/billing.dart';
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
