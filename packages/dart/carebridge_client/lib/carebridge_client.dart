/// The plumbing both CareBridge apps share.
///
/// Small on purpose. What lives here is the part where two implementations
/// would be a *defect* rather than merely duplication:
///
///   * the [Failure] taxonomy and [failureFromResponse], because the API
///     deliberately makes "no such record" and "not yours" indistinguishable,
///     and a second mapping is where that ambiguity gets accidentally undone;
///   * [TokenStore], because a token belongs in encrypted storage and an app
///     that reimplements it is an app that eventually reimplements it in
///     localStorage;
///   * [newId], because an identifier that appears in a URL must not be
///     guessable, and that is a decision rather than a utility;
///   * [ApiTransport], the request and refresh loop.
///
/// That last one was deliberately absent while there were two apps, on the
/// grounds that the duplication was twenty lines and the two had different
/// session shapes. A third app settled it: the shape difference sits entirely
/// in what a caller does with a decoded map, and what was actually being
/// copied is the handful of rules — one refresh attempt, clear on failure,
/// same Idempotency-Key on the retry — where a mistake is invisible until a
/// session storm or a double charge makes it visible.
library;

export 'src/api_transport.dart';
export 'src/error_mapping.dart';
export 'src/failures.dart';
export 'src/ids.dart';
export 'src/token_store.dart';
