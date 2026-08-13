#!/usr/bin/env node
/**
 * Generates packages/dart/carebridge_api from packages/contracts/openapi.json.
 *
 * Why a generator we own rather than openapi-generator:
 *
 *   - openapi-generator needs a JVM in CI and in every developer's toolchain,
 *     and it emits several thousand lines of Dart with its own HTTP
 *     abstraction, its own serialisation conventions and its own opinions
 *     about null safety. Reviewing a regeneration diff is then impossible,
 *     which means nobody reviews it.
 *   - The subset of OpenAPI this API actually produces is small and fixed —
 *     objects, enums, arrays, $refs and primitives — because it all comes from
 *     one NestJS codebase with one set of conventions.
 *   - The output can then look like the rest of our Dart: `package:http`, plain
 *     classes, `fromJson`/`toJson`, and the same error envelope the app
 *     already models in lib/core/failures.dart.
 *
 * Nothing here is hand-edited. `make dart-client` regenerates it, and CI fails
 * a pull request whose committed output is stale.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(HERE, '../packages/contracts/openapi.json');
const OUT = resolve(HERE, '../packages/dart/carebridge_api');

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));

const BANNER = `// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run \`make dart-client\` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.
`;

// ─── naming ──────────────────────────────────────────────────────────────────

const DART_KEYWORDS = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'covariant',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'false',
  'final',
  'finally',
  'for',
  'function',
  'get',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'late',
  'library',
  'mixin',
  'new',
  'null',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'set',
  'show',
  'static',
  'super',
  'switch',
  'sync',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function camel(name) {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) =>
    c ? c.toUpperCase() : '',
  );
  const result = lowerFirst(cleaned);
  return DART_KEYWORDS.has(result) ? `${result}_` : result;
}

function pascal(name) {
  return upperFirst(camel(name));
}

function snake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

/** Wraps prose at 78 columns as `///` doc comments. */
function doc(text, indent = '') {
  if (!text) return '';
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > 74) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.map((l) => `${indent}/// ${l}\n`).join('');
}

// ─── type mapping ────────────────────────────────────────────────────────────

const inlineEnums = new Map();

function refName(ref) {
  return ref.split('/').pop();
}

/**
 * The Dart type for a schema node.
 *
 * Inline enums (a `type: string` with an `enum` list, which is what
 * class-validator's `@IsIn` produces) are hoisted into named Dart enums so the
 * app gets exhaustive `switch` coverage rather than stringly-typed comparisons.
 */
function dartType(schema, context) {
  if (!schema) return 'Object?';
  if (schema.$ref) return pascal(refName(schema.$ref));
  if (schema.allOf?.length === 1 && schema.allOf[0].$ref) {
    // swagger wraps a `$ref` in `allOf` whenever the property carries its own
    // description — the ref is still the type.
    return pascal(refName(schema.allOf[0].$ref));
  }

  if (schema.allOf?.length === 1) return dartType(schema.allOf[0], context);

  if (Array.isArray(schema.enum) && schema.type === 'string') {
    const name = pascal(context);
    if (!inlineEnums.has(name)) {
      inlineEnums.set(name, {
        name,
        values: schema.enum,
        description: schema.description,
      });
    }
    return name;
  }

  switch (schema.type) {
    case 'string':
      return schema.format === 'date-time' ? 'DateTime' : 'String';
    case 'integer':
      return 'int';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'array':
      return `List<${dartType(schema.items, `${context}Item`)}>`;
    case 'object':
      if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      ) {
        return `Map<String, ${dartType(schema.additionalProperties, `${context}Value`)}>`;
      }
      return 'Map<String, dynamic>';
    default:
      return 'Object?';
  }
}

const PRIMITIVES = new Set(['String', 'int', 'double', 'bool', 'Object?']);

/** Reads one JSON value into a Dart value of `type`. */
function fromJsonExpr(type, expr, nullable) {
  const guard = (inner) => (nullable ? `${expr} == null ? null : ${inner}` : inner);

  if (type === 'DateTime') return guard(`DateTime.parse(${expr} as String)`);
  if (type === 'double') return guard(`(${expr} as num).toDouble()`);
  if (PRIMITIVES.has(type)) return `${expr} as ${type}${nullable ? '?' : ''}`;
  if (type === 'Map<String, dynamic>')
    return `${expr} as Map<String, dynamic>${nullable ? '?' : ''}`;

  const list = /^List<(.+)>$/.exec(type);
  if (list) {
    const inner = list[1];
    return guard(
      `(${expr} as List<dynamic>).map((e) => ${fromJsonExpr(inner, 'e', false)}).toList()`,
    );
  }

  const map = /^Map<String, (.+)>$/.exec(type);
  if (map) {
    return guard(
      `(${expr} as Map<String, dynamic>).map((k, v) => MapEntry(k, ${fromJsonExpr(map[1], 'v', false)}))`,
    );
  }

  if (inlineEnums.has(type)) return guard(`${type}.fromJson(${expr} as String)`);
  return guard(`${type}.fromJson(${expr} as Map<String, dynamic>)`);
}

function toJsonExpr(type, expr, nullable) {
  const q = nullable ? '?' : '';
  if (type === 'DateTime') return `${expr}${q}.toIso8601String()`;
  if (PRIMITIVES.has(type) || type === 'Map<String, dynamic>') return expr;

  const list = /^List<(.+)>$/.exec(type);
  if (list) {
    return `${expr}${q}.map((e) => ${toJsonExpr(list[1], 'e', false)}).toList()`;
  }

  const map = /^Map<String, (.+)>$/.exec(type);
  if (map) {
    return `${expr}${q}.map((k, v) => MapEntry(k, ${toJsonExpr(map[1], 'v', false)}))`;
  }
  if (inlineEnums.has(type)) return `${expr}${q}.wireName`;
  return `${expr}${q}.toJson()`;
}

// ─── models ──────────────────────────────────────────────────────────────────

function generateModel(name, schema) {
  const className = pascal(name);
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {});

  const fields = properties.map(([key, prop]) => {
    const type = dartType(prop, `${className}${pascal(key)}`);
    const nullable = !required.has(key) || prop.nullable === true;
    return { key, name: camel(key), type, nullable, description: prop.description };
  });

  // Dart resolves imports per file, so a model that names another model has to
  // say so. Emitted only when needed, because an unused import is an analyzer
  // warning and generated code that warns trains people to ignore warnings.
  const needsModels = fields.some((f) => !isSelfContained(f.type, className));

  let out = BANNER;
  out += '\n';
  if (needsModels) out += "import '../models.dart';\n\n";
  out += doc(schema.description ?? `${className}, from the CareBridge API.`);
  out += `class ${className} {\n`;
  out += `  const ${className}({\n`;
  for (const f of fields) {
    out += `    ${f.nullable ? '' : 'required '}this.${f.name},\n`;
  }
  out += '  });\n\n';

  for (const f of fields) {
    out += doc(f.description, '  ');
    out += `  final ${f.type}${f.nullable ? '?' : ''} ${f.name};\n\n`;
  }

  out += `  factory ${className}.fromJson(Map<String, dynamic> json) => ${className}(\n`;
  for (const f of fields) {
    out += `        ${f.name}: ${fromJsonExpr(f.type, `json['${f.key}']`, f.nullable)},\n`;
  }
  out += '      );\n\n';

  out += '  Map<String, dynamic> toJson() => <String, dynamic>{\n';
  for (const f of fields) {
    if (f.nullable) {
      // Absent rather than explicit null: the API's ValidationPipe strips
      // unknown fields but an explicit null is a value, and for a PATCH-like
      // body that is the difference between "unchanged" and "cleared".
      out += `        if (${f.name} != null) '${f.key}': ${toJsonExpr(f.type, f.name, true)},\n`;
    } else {
      out += `        '${f.key}': ${toJsonExpr(f.type, f.name, false)},\n`;
    }
  }
  out += '      };\n';
  out += '}\n';

  return { fileName: `${snake(className)}.dart`, source: out };
}

/** True when the type needs nothing from outside this file. */
function isSelfContained(type, selfName) {
  const inner = /^(?:List|Map<String,)\s*<?(.+?)>+$/.exec(type)?.[1]?.trim() ?? type;
  return (
    PRIMITIVES.has(inner) ||
    inner === 'DateTime' ||
    inner === 'Map<String, dynamic>' ||
    inner === selfName
  );
}

function generateEnum(entry) {
  let out = BANNER;
  out += '\n';
  // `CareBridgeUnknownEnumValue` lives with the client runtime.
  out += "import '../api_client.dart';\n\n";
  out += doc(entry.description ?? `${entry.name}, as the API spells it.`);
  out += `enum ${entry.name} {\n`;
  for (const value of entry.values) {
    out += `  ${camel(value)}('${value}'),\n`;
  }
  out += '  ;\n\n';
  out += `  const ${entry.name}(this.wireName);\n\n`;
  out += doc(
    'The exact string the API uses. Kept separate from the Dart identifier so a value like "in_progress" stays valid Dart without changing the wire format.',
    '  ',
  );
  out += '  final String wireName;\n\n';
  out += doc(
    'Unknown values throw rather than falling back. A value this client has never heard of means the server is ahead of the app, and silently mapping it to a default would render a ride in the wrong state.',
    '  ',
  );
  out += `  static ${entry.name} fromJson(String value) => values.firstWhere(\n`;
  out += '        (e) => e.wireName == value,\n';
  out += `        orElse: () => throw CareBridgeUnknownEnumValue('${entry.name}', value),\n`;
  out += '      );\n';
  out += '}\n';

  return { fileName: `${snake(entry.name)}.dart`, source: out };
}

// ─── operations ──────────────────────────────────────────────────────────────

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function collectOperations() {
  const byTag = new Map();

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;

      const tag = operation.tags?.[0] ?? 'default';
      const list = byTag.get(tag) ?? [];

      const success = operation.responses?.['200'] ?? operation.responses?.['201'];
      const responseSchema = success?.content?.['application/json']?.schema ?? null;

      list.push({
        path,
        method,
        operationId: operation.operationId,
        summary: operation.summary,
        description: operation.description,
        parameters: [...(item.parameters ?? []), ...(operation.parameters ?? [])],
        requestSchema:
          operation.requestBody?.content?.['application/json']?.schema ?? null,
        responseSchema,
        secured: (operation.security ?? []).length > 0,
      });

      byTag.set(tag, list);
    }
  }

  return byTag;
}

function methodName(operation) {
  const [, handler] = operation.operationId.split('_');
  return camel(handler ?? operation.operationId);
}

function generateApi(tag, operations) {
  const className = `${pascal(tag)}Api`;

  const referenced = new Set();
  const remember = (type) => {
    const inner = /^(?:List|Map<String,)\s*<?(.+?)>+$/.exec(type)?.[1]?.trim() ?? type;
    // `dynamic` falls out of unwrapping `Map<String, dynamic>`, which is what
    // an inline object schema becomes. It lives in no file and needs no import.
    if (!PRIMITIVES.has(inner) && !['DateTime', 'void', 'dynamic'].includes(inner)) {
      referenced.add(inner);
    }
  };

  let body = '';
  body += doc(
    spec.tags?.find((t) => t.name === tag)?.description ??
      `Operations tagged "${tag}".`,
  );
  body += `class ${className} {\n`;
  body += `  const ${className}(this._client);\n\n`;
  body += '  final CareBridgeApiClient _client;\n';

  for (const operation of operations) {
    const pathParams = operation.parameters.filter((p) => p.in === 'path');
    const queryParams = operation.parameters.filter((p) => p.in === 'query');

    const args = [];
    for (const p of pathParams) args.push(`required String ${camel(p.name)}`);
    if (operation.requestSchema) {
      const bodyType = dartType(operation.requestSchema, `${className}Body`);
      remember(bodyType);
      args.push(`required ${bodyType} body`);
    }
    for (const p of queryParams) {
      args.push(`${dartType(p.schema, camel(p.name))}? ${camel(p.name)}`);
    }

    const responseType = operation.responseSchema
      ? dartType(operation.responseSchema, `${pascal(methodName(operation))}Response`)
      : 'void';
    remember(responseType);

    const dartPath = operation.path.replace(
      /\{([^}]+)\}/g,
      (_, name) => `\${Uri.encodeComponent(${camel(name)})}`,
    );

    body += '\n';
    body += doc(operation.summary, '  ');
    if (operation.description && operation.description !== operation.summary) {
      body += '  ///\n';
      body += doc(operation.description, '  ');
    }
    body += `  Future<${responseType}> ${methodName(operation)}(${
      args.length ? `{\n    ${args.join(',\n    ')},\n  }` : ''
    }) async {\n`;

    if (queryParams.length) {
      body += '    final query = <String, String>{\n';
      for (const p of queryParams) {
        body += `      if (${camel(p.name)} != null) '${p.name}': ${camel(p.name)}.toString(),\n`;
      }
      body += '    };\n';
    }

    const bindsResponse = responseType !== 'void';
    body += `    ${bindsResponse ? 'final response = ' : ''}await _client.send(\n`;
    body += `      method: '${operation.method.toUpperCase()}',\n`;
    body += `      path: '${dartPath}',\n`;
    if (operation.requestSchema) body += '      body: body.toJson(),\n';
    if (queryParams.length) body += '      query: query,\n';
    body += '    );\n';

    if (responseType === 'void') {
      body += '    return;\n';
    } else {
      body += `    return ${fromJsonExpr(responseType, 'response', false)};\n`;
    }
    body += '  }\n';
  }

  body += '}\n';

  // The imports are decided from the generated source, not from the schemas.
  // A handler whose response is an inline object becomes `Map<String, dynamic>`
  // and needs nothing from models.dart — importing it anyway is an analyzer
  // warning, and generated code that warns trains people to ignore warnings.
  const needsModels = referenced.size > 0;

  let out = BANNER;
  out += "\nimport '../api_client.dart';\n";
  if (needsModels) out += "import '../models.dart';\n";
  out += '\n';
  out += body;

  return { fileName: `${snake(className)}.dart`, source: out };
}

// ─── the runtime ─────────────────────────────────────────────────────────────

const API_CLIENT = `${BANNER}
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thrown when the server sends an enum value this client does not know.
///
/// Loud on purpose. A value the app has never heard of means the server is
/// ahead of it, and quietly mapping it to a default would render a ride in the
/// wrong state — which, in this product, is a false statement about where
/// somebody's parent is.
class CareBridgeUnknownEnumValue implements Exception {
  const CareBridgeUnknownEnumValue(this.enumName, this.value);

  final String enumName;
  final String value;

  @override
  String toString() =>
      'CareBridgeUnknownEnumValue: \$enumName has no value "\$value". '
      'The app is older than the API it is talking to.';
}

/// The API's one error envelope: \`{ error: { code, message, correlationId } }\`.
///
/// \`notFoundOrForbidden\` is deliberately ambiguous on the server — "no such
/// record" and "not yours" are indistinguishable so the API cannot be used to
/// probe for the existence of a patient or a ride. Clients must not try to
/// tell them apart either.
class CareBridgeApiException implements Exception {
  const CareBridgeApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.correlationId,
    this.field,
  });

  final int statusCode;
  final String code;

  /// Safe to show a user. The server never puts detail in here.
  final String message;

  /// Quote this to support: it is what connects the sentence "it said
  /// something went wrong" to a specific line in the server log.
  final String? correlationId;

  final String? field;

  bool get isAuthentication => statusCode == 401;
  bool get isNotFoundOrForbidden => code == 'not_found_or_forbidden';
  bool get isValidation => code == 'validation';

  @override
  String toString() => 'CareBridgeApiException(\$statusCode \$code): \$message';
}

/// Supplies the access token, and refreshes it when the API says it is stale.
typedef TokenProvider = Future<String?> Function();

/// Called on a 401 so the app can rotate its refresh token. Returns true if a
/// new access token is now available and the request is worth retrying once.
typedef TokenRefresher = Future<bool> Function();

/// The transport every generated API class shares.
class CareBridgeApiClient {
  CareBridgeApiClient({
    required this.baseUrl,
    this.accessToken,
    this.onUnauthorized,
    this.correlationIdFactory,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Root of the API, including the version prefix — e.g.
  /// \`https://api.carebridge.example/api/v1\`.
  final String baseUrl;

  final TokenProvider? accessToken;
  final TokenRefresher? onUnauthorized;

  /// Lets the app tie a user-visible error to a server log line. The server
  /// generates one when the client does not.
  final String Function()? correlationIdFactory;

  final http.Client _http;

  Future<dynamic> send({
    required String method,
    required String path,
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool allowRetry = true,
  }) async {
    final uri = Uri.parse('\$baseUrl\$path').replace(
      queryParameters: (query == null || query.isEmpty) ? null : query,
    );

    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
    };

    final token = await accessToken?.call();
    if (token != null && token.isNotEmpty) {
      headers['authorization'] = 'Bearer \$token';
    }

    final correlationId = correlationIdFactory?.call();
    if (correlationId != null) headers['x-correlation-id'] = correlationId;

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);

    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);

    // One retry, and only after a successful refresh. Retrying on any 401
    // would turn an expired session into an infinite loop against the server.
    if (response.statusCode == 401 && allowRetry && onUnauthorized != null) {
      final refreshed = await onUnauthorized!.call();
      if (refreshed) {
        return send(
          method: method,
          path: path,
          body: body,
          query: query,
          allowRetry: false,
        );
      }
    }

    if (response.statusCode == 204 || response.body.isEmpty) {
      if (response.statusCode >= 400) throw _decodeError(response);
      return null;
    }

    final decoded = jsonDecode(response.body);
    if (response.statusCode >= 400) throw _decodeError(response, decoded);
    return decoded;
  }

  CareBridgeApiException _decodeError(http.Response response, [dynamic decoded]) {
    dynamic payload = decoded;
    if (payload == null && response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = null;
      }
    }

    final error = payload is Map<String, dynamic> ? payload['error'] : null;
    if (error is Map<String, dynamic>) {
      return CareBridgeApiException(
        statusCode: response.statusCode,
        code: error['code'] as String? ?? 'internal',
        message: error['message'] as String? ?? 'Something went wrong.',
        correlationId: error['correlationId'] as String?,
        field: error['field'] as String?,
      );
    }

    // A response that is not our envelope did not come from this API — a
    // proxy error page, a captive portal. Say so generically rather than
    // showing the user somebody else's HTML.
    return CareBridgeApiException(
      statusCode: response.statusCode,
      code: 'internal',
      message: 'Something went wrong on our side. Please try again.',
    );
  }

  void close() => _http.close();
}
`;

// ─── emit ────────────────────────────────────────────────────────────────────

rmSync(resolve(OUT, 'lib'), { recursive: true, force: true });
mkdirSync(resolve(OUT, 'lib/src/models'), { recursive: true });
mkdirSync(resolve(OUT, 'lib/src/api'), { recursive: true });

// Named enums first. `enumName` in the NestJS decorators promotes them to
// top-level schemas — which is the whole point, because the alternative is a
// separate Dart enum per property: the same fifteen values under four names,
// none of them assignable to another. Registering them before any model is
// walked is what lets `dartType` resolve a `$ref` to the shared enum.
const enumSchemas = Object.entries(spec.components?.schemas ?? {}).filter(
  ([, schema]) => Array.isArray(schema.enum) && schema.type === 'string',
);

for (const [name, schema] of enumSchemas) {
  inlineEnums.set(pascal(name), {
    name: pascal(name),
    values: schema.enum,
    description: schema.description,
  });
}

const modelFiles = [];
for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  if (inlineEnums.has(pascal(name))) continue;
  const model = generateModel(name, schema);
  writeFileSync(resolve(OUT, 'lib/src/models', model.fileName), model.source);
  modelFiles.push(model.fileName);
}

// Enums are discovered while walking the models above, so they are written
// afterwards — the map is complete only once every schema has been visited.
const operationsByTag = collectOperations();
const apiFiles = [];
for (const [tag, operations] of operationsByTag) {
  const api = generateApi(tag, operations);
  writeFileSync(resolve(OUT, 'lib/src/api', api.fileName), api.source);
  apiFiles.push(api.fileName);
}

const enumFiles = [];
for (const entry of inlineEnums.values()) {
  const file = generateEnum(entry);
  writeFileSync(resolve(OUT, 'lib/src/models', file.fileName), file.source);
  enumFiles.push(file.fileName);
}

const allModels = [...modelFiles, ...enumFiles].sort();

writeFileSync(
  resolve(OUT, 'lib/src/models.dart'),
  `${BANNER}\n${allModels.map((f) => `export 'models/${f}';`).join('\n')}\n`,
);

writeFileSync(
  resolve(OUT, 'lib/carebridge_api.dart'),
  `${BANNER}
/// The generated CareBridge API client.
///
/// \`\`\`dart
/// final client = CareBridgeApiClient(
///   baseUrl: 'http://localhost:3000/api/v1',
///   accessToken: () async => tokenStore.accessToken,
///   onUnauthorized: tokenStore.refresh,
/// );
/// final auth = AuthApi(client);
/// \`\`\`
library;

export 'src/api_client.dart';
export 'src/models.dart';
${apiFiles
  .sort()
  .map((f) => `export 'src/api/${f}';`)
  .join('\n')}
`,
);

writeFileSync(resolve(OUT, 'lib/src/api_client.dart'), API_CLIENT);

writeFileSync(
  resolve(OUT, 'pubspec.yaml'),
  `# GENERATED — DO NOT EDIT. See scripts/generate-dart-client.mjs.
name: carebridge_api
description: >-
  Generated CareBridge API client. Produced from packages/contracts/openapi.json,
  which is itself generated from the NestJS decorators — so there is exactly one
  description of this API and it is the server code.
version: ${spec.info?.version ?? '0.0.0'}
publish_to: 'none'

# Part of the Dart pub workspace declared in the root pubspec, so one
# resolution covers the app and the client and they cannot drift onto two
# versions of the same dependency.
resolution: workspace

environment:
  sdk: ^3.12.0

dependencies:
  http: ^1.6.0

dev_dependencies:
  # The lints package, not flutter_lints: this is a pure Dart package with no
  # Flutter dependency, and including a rule set it cannot resolve makes
  # "dart analyze" warn about its own configuration.
  lints: ^6.0.0
`,
);

writeFileSync(
  resolve(OUT, 'analysis_options.yaml'),
  `# Generated code is held to the same rules as the rest of the workspace.
#
# It is also \`dart format\`-ed as part of generation rather than exempted from
# the check: the generator is deterministic, so formatting it adds no churn and
# means the committed output satisfies exactly the same gate as hand-written
# Dart.
include: package:lints/recommended.yaml

analyzer:
  errors:
    # The generator emits a doc comment on every field from the OpenAPI
    # description. Where the API has none, there is nothing honest to write.
    public_member_api_docs: ignore
`,
);

writeFileSync(
  resolve(OUT, 'README.md'),
  `# \`carebridge_api\`

**Generated. Never hand-edited.**

\`\`\`
make dart-client   # regenerate from the OpenAPI document
\`\`\`

The chain is: NestJS decorators → \`packages/contracts/openapi.json\` →
this package. There is one description of the API and it is the server code
(FOUNDATION T7).

If something here is wrong, fix the DTO or the controller decorator that
produced it and regenerate. A fix applied here survives until the next
regeneration and no longer.
`,
);

console.log(
  `carebridge_api — ${modelFiles.length} models, ${enumFiles.length} enums, ${apiFiles.length} API classes → ${OUT}`,
);
