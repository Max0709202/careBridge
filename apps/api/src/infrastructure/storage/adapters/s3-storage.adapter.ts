import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { PresignedUpload, StoragePort, StoredObject } from '../storage.port';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Set for MinIO and other S3-compatible endpoints; absent for real S3. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * S3, and anything that speaks its API.
 *
 * The same adapter serves MinIO in the local stack and S3 in production, which
 * is worth the `forcePathStyle` flag below: it means the thing developers run
 * against is the thing production runs against, rather than a different code
 * path that happens to have the same interface.
 *
 * Credentials are deliberately optional. In production the container has an
 * **IAM task role** and the SDK's default provider chain finds it — there are
 * no keys in the environment to leak, rotate or commit. Explicit keys exist
 * for MinIO, which has no such notion.
 */
export class S3StorageAdapter implements StoragePort {
  readonly driver = 's3' as const;

  private readonly logger = new Logger('Storage');
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint
        ? {
            endpoint: options.endpoint,
            // MinIO serves buckets as a path segment rather than a subdomain.
            // Virtual-host style would resolve `bucket.localhost`, which is
            // not a thing.
            forcePathStyle: true,
          }
        : {}),
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: input.key,
      ContentType: input.contentType,
      // Signed, so a client cannot substitute a different length. Combined
      // with the bucket's own size limits this is what stops an authorised
      // slot for a 4 MB photograph becoming a 400 MB upload.
      ContentLength: input.maxBytes,
      // Encrypted at rest with a key the bucket policy names. Belt and braces
      // over the bucket default: an object written without it would be a
      // silent gap in a compliance answer.
      ServerSideEncryption: 'AES256',
    });

    // Ten minutes. Long enough for a large file on a poor connection, short
    // enough that a URL captured from a log or a browser history is dead
    // before anybody could use it.
    const expiresInSeconds = 600;
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      url,
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.maxBytes),
        'x-amz-server-side-encryption': 'AES256',
      },
      expiresInSeconds,
    };
  }

  async presignDownload(input: {
    key: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: input.key,
    });
    // Two minutes by default: long enough to open, too short to share.
    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds ?? 120,
    });
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return {
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
        checksum: result.ETag?.replaceAll('"', '') ?? null,
      };
    } catch (error) {
      // A missing object is the normal answer for an upload that was
      // authorised and never completed, not an error worth raising.
      if (isNotFound(error)) return null;
      this.logger.warn(`Could not read object metadata: ${describe(error)}`);
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
    } catch (error) {
      // Logged rather than thrown. A delete that fails leaves an orphan the
      // bucket's lifecycle rule will collect; a delete that throws would fail
      // the request that was doing something more important.
      this.logger.warn(`Could not remove object: ${describe(error)}`);
    }
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

/** The key is never logged: it is the handle to somebody's licence scan. */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
