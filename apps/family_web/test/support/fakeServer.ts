/**
 * A fake API behind `fetch`, for tests. Routes are matched on "METHOD /path";
 * every request is recorded so a test can assert on what was sent.
 */
export interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (request: Recorded) => { status?: number; body?: unknown; headers?: Record<string, string> };

export function fakeServer(routes: Record<string, Handler>) {
  const requests: Recorded[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/api\/v1/, '') + url.search;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const recorded = { method, path, headers, body };
    requests.push(recorded);

    const key = `${method} ${path.split('?')[0]}`;
    const handler =
      routes[key] ??
      Object.entries(routes).find(([pattern]) => matches(pattern, key))?.[1];
    if (!handler) {
      return json(404, { error: { code: 'not_found_or_forbidden', message: 'nope' } });
    }
    const result = handler(recorded);
    return json(result.status ?? 200, result.body, result.headers);
  };

  return { fetchImpl, requests };
}

/** ":param" segments match anything. */
function matches(pattern: string, key: string): boolean {
  const a = pattern.split(/[ /]/);
  const b = key.split(/[ /]/);
  return a.length === b.length && a.every((part, i) => part.startsWith(':') || part === b[i]);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
