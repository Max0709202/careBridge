/**
 * The pair a signed-in session is made of.
 *
 * The access token is short-lived and sent on every request. The refresh token
 * is long-lived, opaque and single-use — the server rotates it on every use and
 * revokes the whole family if a rotated one is ever presented again.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  read(): AuthTokens | null;
  write(tokens: AuthTokens): void;
  clear(): void;
}

const ACCESS_KEY = 'carebridge.accessToken';
const REFRESH_KEY = 'carebridge.refreshToken';

/**
 * Browser storage, under the same keys the Flutter web build uses.
 *
 * Every method degrades to "no session" rather than throwing — a browser that
 * blocks site data should land the person on the sign-in screen, which is
 * recoverable, not on a white screen, which is not. That is the same contract
 * as `SecureTokenStore` in packages/dart/carebridge_client.
 *
 * The page's `script-src 'self'` Content-Security-Policy is what keeps these
 * readable only by this app's own bundle.
 */
export class BrowserTokenStore implements TokenStore {
  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {}

  read(): AuthTokens | null {
    try {
      const accessToken = this.storage?.getItem(ACCESS_KEY);
      const refreshToken = this.storage?.getItem(REFRESH_KEY);
      if (!accessToken || !refreshToken) return null;
      return { accessToken, refreshToken };
    } catch {
      return null;
    }
  }

  write(tokens: AuthTokens): void {
    try {
      this.storage?.setItem(ACCESS_KEY, tokens.accessToken);
      this.storage?.setItem(REFRESH_KEY, tokens.refreshToken);
    } catch {
      // The session still works while the tab is open; it just will not
      // survive a reload. Better than failing a sign-in that succeeded.
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(ACCESS_KEY);
      this.storage?.removeItem(REFRESH_KEY);
    } catch {
      // Nothing to do: the tokens are unreachable either way.
    }
  }
}

/** For tests, and for any context without browser storage. */
export class InMemoryTokenStore implements TokenStore {
  private tokens: AuthTokens | null = null;

  read(): AuthTokens | null {
    return this.tokens;
  }

  write(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
