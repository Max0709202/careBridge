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
///     guessable, and that is a decision rather than a utility.
///
/// What deliberately does **not** live here is the request/refresh loop. Each
/// app owns exactly one HTTP client because each owns refresh, and the two
/// have different session shapes — the family app carries a whole snapshot
/// back from every mutation, the console does not. Sharing the loop would mean
/// a base class with two subclasses disagreeing about what a response is, which
/// is more coupling than the twenty lines it saves.
library;

export 'src/error_mapping.dart';
export 'src/failures.dart';
export 'src/ids.dart';
export 'src/token_store.dart';
