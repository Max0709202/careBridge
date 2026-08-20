import 'package:uuid/uuid.dart';

const _uuid = Uuid();

/// Identifiers are UUIDs, not sequential integers: an id that appears in a URL
/// or a deep link must not let anyone guess the neighbouring record.
String newId() => _uuid.v4();
