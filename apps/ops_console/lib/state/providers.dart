import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/ops_api.dart';
import '../domain/models.dart';

/// Wiring. Overridden wholesale in tests, which is why every dependency is a
/// provider rather than a constructor call inside a widget.
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final opsApiProvider = Provider<OpsApi>((ref) {
  final api = OpsApi(tokens: ref.watch(tokenStoreProvider));
  ref.onDispose(api.dispose);
  return api;
});

/// Whether a session exists, as far as this tab knows.
///
/// Deliberately not "is the token valid": only the server can answer that, and
/// a client that tried would either duplicate the check or cache a stale
/// answer. A token that turns out to be dead surfaces as an
/// [AuthenticationFailure] from the first request, and [SessionController.end]
/// is what the router listens to.
class SessionController extends Notifier<bool> {
  @override
  bool build() {
    // Resolved asynchronously; the router shows the sign-in screen until it
    // lands, which is the correct default for an unknown session.
    Future(restore);
    return false;
  }

  Future<void> restore() async {
    final tokens = await ref.read(tokenStoreProvider).read();
    state = tokens != null;
  }

  Future<void> signIn({required String email, required String password}) async {
    await ref.read(opsApiProvider).signIn(email: email, password: password);
    state = true;
  }

  Future<void> signOut() async {
    await ref.read(opsApiProvider).signOut();
    ref.invalidate(organizationsProvider);
    ref.invalidate(selectedOrganizationIdProvider);
    state = false;
  }

  /// Ends the session locally after the server has refused a token.
  Future<void> end() async {
    await ref.read(tokenStoreProvider).clear();
    state = false;
  }
}

final sessionProvider = NotifierProvider<SessionController, bool>(
  SessionController.new,
);

final organizationsProvider = FutureProvider<List<Organization>>(
  (ref) async => ref.watch(opsApiProvider).organizations(),
);

/// Which operator the console is currently showing.
///
/// Null until chosen. Somebody can dispatch for two companies, and defaulting
/// to the first would mean a queue that looks empty because it belongs to the
/// wrong operator — which reads as "no work" rather than "wrong screen".
class SelectedOrganizationController extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String organizationId) => state = organizationId;
}

final selectedOrganizationIdProvider =
    NotifierProvider<SelectedOrganizationController, String?>(
      SelectedOrganizationController.new,
    );

/// The organisation in force, resolved against the memberships.
///
/// Returns null rather than throwing when the selected id is not in the list —
/// which happens when somebody's membership is revoked while the tab is open.
/// The shell sends them back to the picker.
final selectedOrganizationProvider = Provider<Organization?>((ref) {
  final id = ref.watch(selectedOrganizationIdProvider);
  if (id == null) return null;

  final organizations = ref.watch(organizationsProvider).value;
  if (organizations == null) return null;

  for (final organization in organizations) {
    if (organization.id == id) return organization;
  }
  return null;
});

final queueProvider = FutureProvider.family<DispatchQueue, String>(
  (ref, organizationId) => ref.watch(opsApiProvider).queue(organizationId),
);

final driversProvider = FutureProvider.family<List<Driver>, String>(
  (ref, organizationId) => ref.watch(opsApiProvider).drivers(organizationId),
);

final vehiclesProvider = FutureProvider.family<List<Vehicle>, String>(
  (ref, organizationId) => ref.watch(opsApiProvider).vehicles(organizationId),
);

final seatsProvider = FutureProvider.family<SeatSummary, String>(
  (ref, organizationId) => ref.watch(opsApiProvider).seats(organizationId),
);

/// Refreshes everything a dispatch decision can change.
///
/// One call rather than three, because assigning a ride moves a driver out of
/// the available pool and off the queue at the same time: refreshing only the
/// queue would leave the roster showing a driver as free while the queue knows
/// they are not.
void invalidateOperationalState(Ref ref, String organizationId) {
  ref.invalidate(queueProvider(organizationId));
  ref.invalidate(driversProvider(organizationId));
}

/// Same, from a widget.
void refreshOperationalState(WidgetRef ref, String organizationId) {
  ref.invalidate(queueProvider(organizationId));
  ref.invalidate(driversProvider(organizationId));
}

/// How often the queue re-reads itself while it is on screen.
///
/// A dispatcher leaves this open all day, and a ride booked by a family two
/// minutes ago has to appear without anybody pressing anything. Ten seconds is
/// short enough that the screen is never meaningfully wrong and long enough
/// that a room of six dispatchers is not a load test.
const queuePollInterval = Duration(seconds: 10);
