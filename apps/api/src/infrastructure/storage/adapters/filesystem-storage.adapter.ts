import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { Logger } from '@nestjs/common';

import type { PresignedUpload, StoragePort, StoredObject } from '../storage.port';

export interface Grant {
  token: string;
  key: string;
  method: 'GET' | 'PUT';
  contentType?: string;
  maxBytes?: number;
  expiresAt: number;
}

/**
 * A directory on disk, with the pre-signed URL dance played out locally.
 *
 * Not a mock. It exists so the *shape* of the flow — authorise, upload out of
 * band, confirm, download through a URL that expires — is the same on a laptop
 * as in production. A local adapter that let the API accept a multipart body
 * would mean developers exercising a code path the deployed system does not
 * have, which is how "it worked locally" gets said out loud.
 *
 * The signed URLs point at this API's own `/storage/local/:token` endpoints,
 * which verify the token, honour the expiry, and enforce the content type and
 * size exactly as S3 would. What it cannot reproduce is durability, and that is
 * why **production refuses it**: a driver's insurance certificate on a
 * container's ephemeral disk is a document that vanishes at the next deploy.
 */
export class FilesystemStorageAdapter implements StoragePort {
  readonly driver = 'filesystem' as const;

  private readonly logger = new Logger('Storage');
  private readonly root: string;

  /**
   * Grants, held in memory on purpose. A signature that survived a restart
   * would be a durable credential sitting on a developer's disk, which is the
   * property the ten-minute expiry exists to avoid.
   */
  private readonly grants = new Map<string, Grant>();

  constructor(
    root: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(root);
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload> {
    const expiresInSeconds = 600;
    const token = this.grant({
      key: input.key,
      method: 'PUT',
      contentType: input.contentType,
      maxBytes: input.maxBytes,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });

    return {
      url: `${this.publicBaseUrl}/storage/local/${token}`,
      headers: { 'content-type': input.contentType },
      expiresInSeconds,
    };
  }

  async presignDownload(input: {
    key: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const seconds = input.expiresInSeconds ?? 120;
    const token = this.grant({
      key: input.key,
      method: 'GET',
      expiresAt: Date.now() + seconds * 1000,
    });
    return `${this.publicBaseUrl}/storage/local/${token}`;
  }

  async head(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      const bytes = await readFile(path);
      return {
        byteSize: info.size,
        contentType: await this.typeOf(path),
        checksum: createHash('md5').update(bytes).digest('hex'),
      };
    } catch {
      // A missing object is the normal answer for an upload that was
      // authorised and never completed.
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true }).catch(() => undefined);
    await rm(`${path}.type`, { force: true }).catch(() => undefined);
  }

  // ─── what the local endpoints call ────────────────────────────────────────

  /** Resolves a token, or null when it is unknown, spent, expired or misused. */
  claim(token: string, method: 'GET' | 'PUT'): Grant | null {
    const grant = this.grants.get(token);
    if (!grant) return null;

    if (grant.expiresAt <= Date.now()) {
      this.grants.delete(token);
      return null;
    }
    // A download token must not be usable to write. S3 signs the method into
    // the signature; this has to check it explicitly.
    if (grant.method !== method) return null;

    return grant;
  }

  async write(grant: Grant, body: Buffer, contentType: string): Promise<void> {
    if (grant.maxBytes !== undefined && body.byteLength > grant.maxBytes) {
      throw new Error('too large');
    }
    if (grant.contentType && contentType !== grant.contentType) {
      throw new Error('wrong content type');
    }

    const path = this.pathFor(grant.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.type`, contentType, 'utf8');

    // One shot, like a pre-signed PUT that has been spent.
    this.grants.delete(grant.token);
  }

  async read(grant: Grant): Promise<{ body: Buffer; contentType: string } | null> {
    const path = this.pathFor(grant.key);
    try {
      return { body: await readFile(path), contentType: await this.typeOf(path) };
    } catch {
      return null;
    }
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  private async typeOf(path: string): Promise<string> {
    return (
      (await readFile(`${path}.type`, 'utf8').catch(() => null)) ??
      'application/octet-stream'
    );
  }

  private grant(input: Omit<Grant, 'token'>): string {
    const token = randomBytes(24).toString('base64url');
    this.grants.set(token, { ...input, token });
    this.sweep();
    return token;
  }

  /** Keeps the map from being a slow leak on a long-running dev server. */
  private sweep(): void {
    const now = Date.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }

  /**
   * Maps a storage key onto a path, refusing anything that escapes the root.
   *
   * Keys are generated by this API and contain no user input, so this should
   * be unreachable — which is exactly why it is here. A traversal check that
   * exists only where somebody remembered to think about it is a check that
   * eventually is not there.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, normalize(key)));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      this.logger.error('Rejected a storage key that escapes the root');
      throw new Error('invalid key');
    }
    return path;
  }
}
