import {
  authenticationFailure,
  Failure,
  failureFromResponse,
  networkFailure,
} from './failures';
import type { AuthTokens, TokenStore } from './tokens';
import { observeServerDate } from '../core/serverClock';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SendOptions {
  body?: unknown;
  authenticated?: boolean;
  idempotencyKey?: string;
}

/**
 * Relative by default: nginx proxies `/api` from the page's own origin, so the
 * bundle never learns the API's hostname and the Content-Security-Policy stays
 * at `connect-src 'self'`. Override at build time with
 * `VITE_CAREBRIDGE_API_BASE_URL` for a separately hosted API.
 */
export const configuredBaseUrl: string =
  (import.meta.env.VITE_CAREBRIDGE_API_BASE_URL as string | undefined) ?? '/api/v1';

export function resolveBaseUrl(raw: string, origin = window.location.origin): URL {
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return new URL(trimmed === '' ? '/' : trimmed, origin);
}

/**
 * The request/refresh loop, with the same rules as ApiTransport in
 * packages/dart/carebridge_client:
 *
 *  - **One refresh attempt, then stop.** Looping on 401 turns an expired
 *    session into a request storm against the auth endpoint.
 *  - **A failed refresh clears the session locally**, so a browser never keeps
 *    retrying with tokens the server has already revoked.
 *  - **The retry carries the same Idempotency-Key.** A 401 fixed by a refresh
 *    is one request, not two.
 *  - **One client per app, because one client owns refresh.**
 *
 * One addition the browser needs: concurrent 401s share a single refresh. Two
 * tabs' worth of parallel requests each presenting the same single-use refresh
 * token is exactly what reuse detection revokes the whole session family for.
 */
export class ApiTransport {
  readonly baseUrl: URL;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    readonly tokens: TokenStore,
    baseUrl: string = configuredBaseUrl,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.baseUrl = resolveBaseUrl(baseUrl);
  }

  /** One request that answers with an object (or nothing), with a single refresh-and-retry on 401. */
  async send<T = Record<string, unknown>>(
    method: Method,
    path: string,
    options: SendOptions = {},
  ): Promise<T> {
    const body = await this.sendRaw(method, path, options);
    if (body === null) return {} as T;
    if (typeof body === 'object' && !Array.isArray(body)) return body as T;
    throw networkFailure();
  }

  /** The list-shaped sibling of [send]. */
  async sendList<T = unknown>(
    method: Method,
    path: string,
    options: SendOptions = {},
  ): Promise<T[]> {
    const body = await this.sendRaw(method, path, options);
    if (body === null) return [];
    if (Array.isArray(body)) return body as T[];
    throw networkFailure();
  }

  storeSession(json: { accessToken?: unknown; refreshToken?: unknown }): void {
    if (typeof json.accessToken !== 'string' || typeof json.refreshToken !== 'string') {
      throw networkFailure();
    }
    this.tokens.write({ accessToken: json.accessToken, refreshToken: json.refreshToken });
  }

  private async sendRaw(method: Method, path: string, options: SendOptions): Promise<unknown> {
    const authenticated = options.authenticated ?? true;
    let response = await this.request(method, path, options, authenticated);

    if (response.status === 401 && authenticated) {
      if (!(await this.refreshOnce())) {
        this.tokens.clear();
        throw authenticationFailure();
      }
      // The same Idempotency-Key, deliberately — see the class comment.
      response = await this.request(method, path, options, authenticated);
    }

    return this.decode(response);
  }

  private async request(
    method: Method,
    path: string,
    options: SendOptions,
    authenticated: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    if (authenticated) {
      const stored = this.tokens.read();
      if (!stored) throw authenticationFailure();
      headers.Authorization = `Bearer ${stored.accessToken}`;
    }

    try {
      const sentAt = Date.now();
      const response = await this.fetchImpl(`${this.baseUrl.toString()}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // Tokens travel in the Authorization header, never in cookies.
        credentials: 'omit',
      });
      observeServerDate(response.headers.get('date'), sentAt, Date.now());
      return response;
    } catch {
      // The message a user sees never carries a URL, a host or a stack frame.
      throw networkFailure();
    }
  }

  private refreshOnce(): Promise<boolean> {
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<boolean> {
    const stored: AuthTokens | null = this.tokens.read();
    if (!stored) return false;
    try {
      const response = await this.request(
        'POST',
        '/auth/refresh',
        { body: { refreshToken: stored.refreshToken } },
        false,
      );
      if (!response.ok) return false;
      this.storeSession((await response.json()) as Record<string, unknown>);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A body that will not parse, on a response that failed anyway, maps to the
   * status the server returned. On a *successful* response the same body is a
   * network failure — silently returning an empty object would render as a
   * family with no patients rather than as something going wrong.
   */
  private async decode(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '');
    let body: unknown = null;
    let parsed = true;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (response.ok) {
      if (!parsed) throw networkFailure();
      return body;
    }
    // The API always answers a 404 or 5xx with its JSON error envelope. The same
    // status as an HTML page means something else answered — a proxy with no
    // upstream, or another server on the port — so the API was never reached.
    // Saying "not found or no access" there sends people looking in the wrong place.
    if (!parsed && (response.status === 404 || response.status >= 500)) {
      throw networkFailure();
    }
    throw failureFromResponse(response.status, parsed ? body : {}, response.headers);
  }
}

export { Failure };
