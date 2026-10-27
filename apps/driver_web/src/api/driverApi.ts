/**
 * The driver app's API. A port of lib/data/driver_api.dart.
 *
 * None of these paths carry a driver id: a driver acts as themselves, resolved
 * from the token, and only on rides that already name them. The refresh loop
 * comes from [ApiTransport].
 */
import type { DriverProfile, Fix, Job } from '../domain/models';
import { fixToJson } from '../domain/models';
import type { RideStatus } from '../domain/rideStatus';
import {
  jobFromWire,
  profileFromWire,
  type DocumentKind,
  type DriverDocuments,
  type FlushResult,
  type PresignedUpload,
} from './codec';
import { networkFailure, validationFailure } from './failures';
import { newId } from './ids';
import type { components } from './schema';
import { ApiTransport } from './transport';
import type { TokenStore } from './tokens';

type S = components['schemas'];

export class DriverApi extends ApiTransport {
  constructor(
    tokens: TokenStore,
    baseUrl?: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    super(tokens, baseUrl, fetcher);
  }

  // ─── session ──────────────────────────────────────────────────────────────

  async signIn(input: {
    email: string;
    password: string;
    mfaCode?: string;
  }): Promise<void> {
    const json = await this.send<{ accessToken?: unknown; refreshToken?: unknown }>(
      'POST',
      '/auth/login',
      {
        body: {
          email: input.email.trim(),
          password: input.password,
          ...(input.mfaCode ? { mfaCode: input.mfaCode.trim() } : {}),
        },
        authenticated: false,
      },
    );
    this.storeSession(json);
  }

  /**
   * Ends the session on the server and, whatever happens there, on this
   * device. A driver handing a phone back at the end of a shift must not stay
   * signed in because a request timed out.
   */
  async signOut(): Promise<void> {
    const stored = this.tokens.read();
    try {
      if (stored) {
        await this.send('POST', '/auth/logout', {
          body: { refreshToken: stored.refreshToken },
        });
      }
    } catch {
      // Already going; the local half below is the part that matters.
    } finally {
      this.tokens.clear();
    }
  }

  // ─── the driver ───────────────────────────────────────────────────────────

  /**
   * The signed-in driver, claiming their roster place on first use. A 404 means
   * this account is not on anybody's roster — the screen says so in words.
   */
  async profile(): Promise<DriverProfile> {
    return profileFromWire(await this.send<S['DriverProfileDto']>('GET', '/driver/me'));
  }

  async setShift(onShift: boolean): Promise<DriverProfile> {
    return profileFromWire(
      await this.send<S['DriverProfileDto']>('PUT', '/driver/shift', {
        body: { onShift },
      }),
    );
  }

  // ─── the work ─────────────────────────────────────────────────────────────

  async jobs(): Promise<Job[]> {
    const rides = await this.sendList<S['DriverRideDto']>('GET', '/driver/rides');
    return rides.map(jobFromWire).filter((job): job is Job => job !== null);
  }

  /**
   * Moves a ride to its next state. Idempotency-keyed because the tap happens
   * in a moving vehicle on a patchy connection, where a retry and a double
   * press look the same.
   */
  async advance(rideId: string, to: RideStatus): Promise<Job | null> {
    return jobFromWire(
      await this.send<S['DriverRideDto']>(
        'POST',
        `/driver/rides/${encodeURIComponent(rideId)}/advance`,
        {
          body: { to },
          idempotencyKey: newId(),
        },
      ),
    );
  }

  // ─── paperwork ────────────────────────────────────────────────────────────

  documents(): Promise<DriverDocuments> {
    return this.send<DriverDocuments>('GET', '/driver/documents');
  }

  /** Authorises one upload and returns where to PUT the bytes. */
  authoriseUpload(input: {
    kind: DocumentKind;
    contentType: string;
    expiresAt?: Date;
  }): Promise<PresignedUpload> {
    return this.send<PresignedUpload>('POST', '/driver/documents', {
      body: {
        kind: input.kind,
        contentType: input.contentType,
        ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
      },
    });
  }

  /**
   * PUTs the bytes to the signed URL — outside the transport on purpose. This
   * request carries no bearer token (that would be a session handed to a third
   * party), and it sends exactly the headers the signature covers.
   */
  async uploadBytes(slot: PresignedUpload, body: Blob): Promise<void> {
    if (body.size > slot.maxBytes) {
      throw validationFailure(
        `That file is too large. The limit is ${Math.floor(slot.maxBytes / (1024 * 1024))} MB.`,
      );
    }
    let response: Response;
    try {
      response = await this.fetcher(slot.url, {
        method: 'PUT',
        headers: { ...slot.headers },
        body,
        credentials: 'omit',
      });
    } catch {
      throw networkFailure();
    }
    if (!response.ok) throw networkFailure();
  }

  /** The server checks storage rather than believing this client. */
  confirmUpload(documentId: string): Promise<DriverDocuments> {
    return this.send<DriverDocuments>('POST', '/driver/documents/confirm', {
      body: { documentId },
    });
  }

  // ─── position ─────────────────────────────────────────────────────────────

  /**
   * Empties part of the offline queue. Not idempotency-keyed: the server makes
   * a repeated batch a no-op through a unique `(rideId, capturedAt)`.
   */
  flush(rideId: string, fixes: readonly Fix[]): Promise<FlushResult> {
    return this.send<FlushResult>(
      'POST',
      `/driver/rides/${encodeURIComponent(rideId)}/locations`,
      {
        body: { points: fixes.map(fixToJson) },
      },
    );
  }
}
