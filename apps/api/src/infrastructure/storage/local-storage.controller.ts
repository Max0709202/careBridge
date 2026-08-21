import { Controller, Get, Headers, Inject, Param, Put, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../modules/auth/auth.guard';
import { NotFoundError, ValidationError } from '../../common/errors';
import { STORAGE, type StoragePort } from './storage.port';
import { FilesystemStorageAdapter } from './adapters/filesystem-storage.adapter';

/**
 * The endpoints a pre-signed URL points at when there is no S3.
 *
 * `@Public()`, and that wants explaining, because it is the only unauthenticated
 * route in this system that touches a driver's licence. **The token is the
 * authorisation.** It is 24 random bytes, it names one object and one method,
 * it expires in minutes, and a PUT token is spent on first use. That is
 * precisely what an S3 pre-signed URL is; requiring a bearer token here as
 * well would mean the local flow authorised differently from the deployed one,
 * and the whole point of this adapter is that it does not.
 *
 * Excluded from the OpenAPI document because it is not part of the product's
 * contract — in production these routes answer 404 and the URLs point at S3.
 */
@ApiExcludeController()
@Controller('storage/local')
export class LocalStorageController {
  constructor(@Inject(STORAGE) private readonly storage: StoragePort) {}

  @Put(':token')
  @Public()
  async upload(
    @Param('token') token: string,
    @Req() request: Request,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ ok: true }> {
    const adapter = this.local();
    const grant = adapter.claim(token, 'PUT');
    // Unknown, expired, spent, or a download token being used to write. All
    // four answer the same 404, for the same reason every other lookup in this
    // codebase does: the error must not confirm that a key exists.
    if (!grant) throw new NotFoundError();

    // Read from the stream rather than through a body parser. Nest parses JSON
    // and form bodies; an image or a PDF reaches here untouched, and adding a
    // global raw parser to serve one development-only route would change how
    // every other request is handled.
    const body = await collect(request, grant.maxBytes ?? DEFAULT_MAX_BYTES);
    if (!body) {
      throw new ValidationError('That upload is larger than was authorised.');
    }

    try {
      await adapter.write(grant, body, contentType ?? 'application/octet-stream');
    } catch {
      throw new ValidationError('That upload does not match what was authorised.');
    }
    return { ok: true };
  }

  @Get(':token')
  @Public()
  async download(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const adapter = this.local();
    const grant = adapter.claim(token, 'GET');
    if (!grant) throw new NotFoundError();

    const object = await adapter.read(grant);
    if (!object) throw new NotFoundError();

    // `attachment` rather than `inline`, and a nosniff header: this serves
    // whatever a driver uploaded, and a file that renders in the browser is a
    // file that can carry script on this API's own origin.
    res
      .setHeader('content-type', object.contentType)
      .setHeader('x-content-type-options', 'nosniff')
      .setHeader('content-disposition', 'attachment')
      .setHeader('cache-control', 'no-store')
      .send(object.body);
  }

  /**
   * In production the S3 adapter is live and these routes are dead ends.
   *
   * Answering 404 rather than being unregistered keeps the route table the
   * same in every environment — one fewer way for staging and production to
   * differ in a manner nobody notices until it matters.
   */
  private local(): FilesystemStorageAdapter {
    if (!(this.storage instanceof FilesystemStorageAdapter)) throw new NotFoundError();
    return this.storage;
  }
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Reads a request body, giving up the moment it exceeds what was authorised.
 *
 * Counted as it arrives rather than checked at the end, because checking at
 * the end means a caller can make this process buffer a gigabyte before being
 * told no.
 */
async function collect(request: Request, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > maxBytes) {
      request.destroy();
      return null;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}
