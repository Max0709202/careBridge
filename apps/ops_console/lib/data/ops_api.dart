// Prefixed, as in the family app: the generated package carries the **wire**
// types and several share a name with this console's own domain enums —
// `DriverStatus`, `DispatchUrgency`. The prefix keeps the domain model
// primary, which is the right way round. The UI is written against the domain;
// the wire shape is an implementation detail of this file.
import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';

import '../domain/admin.dart';
import '../domain/billing.dart';
import '../domain/dispatch.dart';
import '../domain/models.dart';
import 'admin_codec.dart';
import 'billing_codec.dart';
import 'ops_codec.dart';

/// The console's HTTP client.
///
/// One client, because it owns refresh. Two of them each retrying a 401 will
/// eventually both present the same rotated refresh token, and the server's
/// reuse detection will — correctly — revoke the whole session family. On the
/// family app that signs somebody out of their phone; here it signs a
/// dispatcher out mid-shift with a queue on screen, which is worse.
///
/// Everything below is scoped by an organisation id in the path. That scoping
/// **is** the authorisation: no endpoint takes a driver or ride id as a
/// capability, `requireMembership` runs first on the server, and an id
/// belonging to another company answers 404 — indistinguishable from one that
/// does not exist. This client must not invent a distinction it was not given.
class OpsApi extends ApiTransport {
  OpsApi({required super.tokens, super.baseUrl, super.client});

  // ─── session ──────────────────────────────────────────────────────────────

  Future<void> signIn({required String email, required String password}) async {
    final json = await send(
      'POST',
      '/auth/login',
      body: {'email': email.trim(), 'password': password},
      authenticated: false,
    );
    await storeSession(json);
  }

  Future<void> signOut() async {
    // Cleared first, and unconditionally. A logout that fails on the network
    // must still end the session on this machine — a dispatcher walking away
    // from a shared terminal cannot be left signed in because a request
    // timed out.
    await tokens.clear();
    try {
      await send('POST', '/auth/logout-all');
    } catch (_) {
      // Already signed out locally, which is the part that matters here.
    }
  }

  // ─── organisations ────────────────────────────────────────────────────────

  /// Organisations the signed-in user holds a role in.
  ///
  /// The console has no notion of "the" organisation: somebody can dispatch
  /// for two operators, and picking one is a decision rather than a default.
  Future<List<Organization>> organizations() async =>
      (await sendList('GET', '/organizations'))
          .map((e) => wire.OrganizationDto.fromJson(e as Map<String, dynamic>))
          .map(organizationFromWire)
          .nonNulls
          .toList();

  // ─── the queue ────────────────────────────────────────────────────────────

  Future<DispatchQueue> queue(String organizationId) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await send('GET', '/organizations/$organizationId/dispatch/queue'),
    ),
  );

  /// Gives a ride to a driver, or moves it to another one.
  ///
  /// [reason] is required by the server when taking a ride off a driver who
  /// already had it, and the reassignment passes through
  /// `reassignmentRequired` so the family's timeline records that the first
  /// driver dropped it rather than showing a silent swap.
  Future<DispatchQueue> assign({
    required String organizationId,
    required String rideId,
    required String driverId,
    String? reason,
  }) async => queueFromWire(
    wire.DispatchQueueDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/dispatch/rides/$rideId/assign',
        // A dispatcher double-tapping on a slow connection must not produce
        // two assignments, and at the HTTP level a retry is indistinguishable
        // from a second decision.
        idempotencyKey: newId(),
        body: {
          'driverId': driverId,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  // ─── roster and fleet ─────────────────────────────────────────────────────

  Future<List<Driver>> drivers(String organizationId) async =>
      (await sendList('GET', '/organizations/$organizationId/drivers'))
          .map((e) => wire.DriverDto.fromJson(e as Map<String, dynamic>))
          .map(driverFromWire)
          .nonNulls
          .toList();

  Future<Driver?> setDriverStatus({
    required String organizationId,
    required String driverId,
    required DriverStatus to,
    String? reason,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/drivers/$driverId/status',
        body: {
          'to': to.wire,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      ),
    ),
  );

  Future<Driver?> setShift({
    required String organizationId,
    required String driverId,
    required bool onShift,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'PUT',
        '/organizations/$organizationId/drivers/$driverId/shift',
        body: {'onShift': onShift},
      ),
    ),
  );

  Future<Driver?> addDriver({
    required String organizationId,
    required String displayName,
    required String vehicleId,
    int? yearsDriving,
  }) async => driverFromWire(
    wire.DriverDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/drivers',
        idempotencyKey: newId(),
        body: {
          'displayName': displayName.trim(),
          'vehicleId': vehicleId,
          'yearsDriving': ?yearsDriving,
        },
      ),
    ),
  );

  Future<List<Vehicle>> vehicles(String organizationId) async =>
      (await sendList('GET', '/organizations/$organizationId/vehicles'))
          .map((e) => wire.VehicleDto.fromJson(e as Map<String, dynamic>))
          .map(vehicleFromWire)
          .toList();

  Future<Vehicle> addVehicle({
    required String organizationId,
    required String make,
    required String model,
    required String color,
    required String licensePlate,
    required bool isWheelchairAccessible,
  }) async => vehicleFromWire(
    wire.VehicleDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/vehicles',
        idempotencyKey: newId(),
        body: {
          'make': make.trim(),
          'model': model.trim(),
          'color': color.trim(),
          'licensePlate': licensePlate.trim(),
          'isWheelchairAccessible': isWheelchairAccessible,
        },
      ),
    ),
  );

  // ─── paperwork ────────────────────────────────────────────────────────────

  Future<wire.DriverComplianceDto> documentsFor({
    required String organizationId,
    required String driverId,
  }) async => wire.DriverComplianceDto.fromJson(
    await send(
      'GET',
      '/organizations/$organizationId/drivers/$driverId/documents',
    ),
  );

  /// A short-lived link to one document.
  ///
  /// A POST rather than a GET because it is not a read: it mints a credential
  /// and writes an audit row saying that a named person looked at a named
  /// driver's licence. "Who has seen this" cannot be answered after the fact.
  Future<wire.DocumentViewUrlDto> viewDocument({
    required String organizationId,
    required String driverId,
    required String documentId,
  }) async => wire.DocumentViewUrlDto.fromJson(
    await send(
      'POST',
      '/organizations/$organizationId/drivers/$driverId/documents/$documentId/view',
    ),
  );

  Future<wire.DriverComplianceDto> reviewDocument({
    required String organizationId,
    required String driverId,
    required String documentId,
    required bool approve,
    String? note,
  }) async => wire.DriverComplianceDto.fromJson(
    await send(
      'POST',
      '/organizations/$organizationId/drivers/$driverId/documents/$documentId/review',
      body: {
        'decision': approve ? 'approved' : 'rejected',
        if (note != null && note.isNotEmpty) 'note': note,
      },
    ),
  );

  // ─── seats ────────────────────────────────────────────────────────────────

  Future<SeatSummary> seats(String organizationId) async => seatsFromWire(
    wire.OrganizationSeatsDto.fromJson(
      await send('GET', '/organizations/$organizationId/seats'),
    ),
  );

  // ─── the operator's subscription ──────────────────────────────────────────
  //
  // The **second** payer (ADR-0011). Scoped by organisation id in the path
  // like everything else above, and answered by `requireMembership` before any
  // of it runs — a role that may work the queue is not necessarily a role that
  // may change what the company is billed, and the server is what decides
  // that.

  Future<BillingAccount> billing(String organizationId) async =>
      accountFromWire(
        wire.BillingAccountDto.fromJson(
          await send('GET', '/organizations/$organizationId/billing'),
        ),
      );

  /// The operator side of the plan catalogue.
  ///
  /// Filtered by the server through `?payer=`, not here. A console that
  /// filtered a full catalogue client-side would be one release away from
  /// offering a household plan to a transport company.
  Future<List<OperatorPlan>> plans() async =>
      (await sendList('GET', '/billing/plans?payer=dispatchOrganization'))
          .map(
            (e) => wire.SubscriptionPlanDto.fromJson(e as Map<String, dynamic>),
          )
          .map(planFromWire)
          .nonNulls
          .toList();

  Future<List<Invoice>> invoices(String organizationId) async =>
      (await sendList('GET', '/organizations/$organizationId/billing/invoices'))
          .map((e) => wire.InvoiceDto.fromJson(e as Map<String, dynamic>))
          .map(invoiceFromWire)
          .nonNulls
          .toList();

  Future<BillingAccount> subscribe({
    required String organizationId,
    required String planCode,
    required BillingInterval interval,
  }) async => accountFromWire(
    wire.BillingAccountDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/billing/subscribe',
        // A double-tap on a slow connection must not start two subscriptions,
        // and at the HTTP level a retry is indistinguishable from a second
        // decision.
        idempotencyKey: newId(),
        body: {'planCode': planCode, 'interval': interval.wire},
      ),
    ),
  );

  Future<BillingAccount> changeInterval({
    required String organizationId,
    required BillingInterval interval,
  }) async => accountFromWire(
    wire.BillingAccountDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/billing/change-interval',
        body: {'interval': interval.wire},
      ),
    ),
  );

  Future<BillingAccount> cancelSubscription(String organizationId) async =>
      accountFromWire(
        wire.BillingAccountDto.fromJson(
          await send('POST', '/organizations/$organizationId/billing/cancel'),
        ),
      );

  /// Puts a card on the operator's account.
  ///
  /// [token] is a reference obtained **directly from the payment processor**.
  /// No endpoint in this system accepts a card number and this method cannot
  /// be given one — ADR-0006 puts that boundary at the client, which is why
  /// the parameter is a token rather than a number this console would then
  /// have to be trusted not to log.
  Future<PaymentMethod?> attachPaymentMethod({
    required String organizationId,
    required String token,
  }) async => paymentMethodFromWire(
    wire.PaymentMethodDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/billing/payment-method',
        idempotencyKey: newId(),
        body: {'token': token},
      ),
    ),
  );

  Future<void> detachPaymentMethod({
    required String organizationId,
    required String paymentMethodId,
  }) async {
    await send(
      'DELETE',
      '/organizations/$organizationId/billing/payment-method/$paymentMethodId',
    );
  }

  /// Charges an open invoice now.
  ///
  /// For the moment after a declined card is replaced: waiting a day for the
  /// scheduled retry, while the screen still says the payment failed, reads as
  /// the update not having worked.
  Future<Invoice?> payInvoice({
    required String organizationId,
    required String invoiceId,
  }) async => invoiceFromWire(
    wire.InvoiceDto.fromJson(
      await send(
        'POST',
        '/organizations/$organizationId/billing/invoices/$invoiceId/pay',
      ),
    ),
  );

  // ─── administration ───────────────────────────────────────────────────────
  //
  // Not scoped by organisation, and that is the difference that shapes the
  // whole section: an operator's owner has complete authority over their own
  // company and none at all over anybody else's, while platform support has a
  // narrow read-only view across all of them. `PlatformRoleGuard` decides,
  // per request rather than from the token, and refuses with the same 404
  // every other lookup uses.
  //
  // Support reads and admin writes. The console cannot tell which it is
  // holding — nothing on the wire says so, by design — so it offers the write
  // controls and renders the refusal plainly if one comes back. Hiding them on
  // a guess would hide them from the people who have the standing too.

  /// Whether this account can see the administration surface at all.
  ///
  /// A probe rather than a claim on a profile: the server deliberately does
  /// not tell a client what platform standing it holds, because an endpoint
  /// that did would let an ordinary account discover that `/admin` exists.
  /// Asking for the cheapest support-level read and treating a refusal as
  /// "no" gets the same answer without adding that endpoint.
  ///
  /// Any failure answers false. A network error is indistinguishable from a
  /// refusal from here, and the console's only use for the answer is whether
  /// to show a navigation item — an item that is briefly missing during an
  /// outage is a smaller wrong than one that is shown and then 404s.
  Future<bool> hasPlatformAccess() async {
    try {
      await stats();
      return true;
    } on Failure {
      return false;
    }
  }

  Future<PlatformStats> stats() async => statsFromWire(
    wire.PlatformStatsDto.fromJson(await send('GET', '/admin/stats')),
  );

  /// One keyset page of the audit log.
  ///
  /// [cursor] comes from the previous page and nothing else. Building one by
  /// hand — a timestamp, a row count — is how a reader ends up with a page
  /// that silently omits the rows appended while they were reading.
  Future<AuditPage> auditLog({
    AuditFilter filter = const AuditFilter(),
    String? cursor,
  }) async {
    final query = <String, String>{
      if ((filter.action ?? '').isNotEmpty) 'action': filter.action!,
      if ((filter.entityType ?? '').isNotEmpty)
        'entityType': filter.entityType!,
      if ((filter.entityId ?? '').isNotEmpty) 'entityId': filter.entityId!,
      'cursor': ?cursor,
    };
    final suffix = query.isEmpty
        ? ''
        : '?${query.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&')}';

    return auditPageFromWire(
      wire.AuditPageDto.fromJson(await send('GET', '/admin/audit$suffix')),
    );
  }

  Future<List<FeatureFlag>> flags() async =>
      (await sendList('GET', '/admin/flags'))
          .map((e) => wire.FeatureFlagDto.fromJson(e as Map<String, dynamic>))
          .map(flagFromWire)
          .toList();

  /// Creates or updates a flag.
  ///
  /// [confirmNarrowing] is sent only when the console has actually asked. The
  /// server refuses a narrowing that did not say so, and a client that always
  /// sent `true` would turn a deliberate speed bump into a field nobody reads.
  Future<List<FeatureFlag>> setFlag({
    required String key,
    required String description,
    required bool enabled,
    required int rolloutPercent,
    bool confirmNarrowing = false,
  }) async =>
      (await sendList(
            'PUT',
            '/admin/flags/${Uri.encodeComponent(key)}',
            body: {
              'description': description.trim(),
              'enabled': enabled,
              'rolloutPercent': rolloutPercent,
              if (confirmNarrowing) 'confirmNarrowing': true,
            },
          ))
          .map((e) => wire.FeatureFlagDto.fromJson(e as Map<String, dynamic>))
          .map(flagFromWire)
          .toList();

  Future<RefundableInvoice> refundable(String invoiceId) async =>
      refundableFromWire(
        wire.RefundableInvoiceDto.fromJson(
          await send('GET', '/admin/invoices/$invoiceId/refunds'),
        ),
      );

  /// Sends money back.
  ///
  /// [paymentId] is carried from the lookup rather than resolved server-side,
  /// so a refund cannot be applied to a payment the reader was not looking at.
  /// [amountCents] is bounded by what is left on that payment, and the server
  /// checks the bound again — this one only keeps the screen honest.
  Future<RefundableInvoice> issueRefund({
    required String invoiceId,
    required String paymentId,
    required int amountCents,
    required String reason,
  }) async => refundableFromWire(
    wire.RefundableInvoiceDto.fromJson(
      await send(
        'POST',
        '/admin/invoices/$invoiceId/refunds',
        // A retried refund must not be a second one.
        idempotencyKey: newId(),
        body: {
          'paymentId': paymentId,
          'amountCents': amountCents,
          'reason': reason.trim(),
        },
      ),
    ),
  );
}
