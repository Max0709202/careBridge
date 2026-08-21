/**
 * Object storage, independent of the vendor.
 *
 * Behind a port for the usual reason and one specific one. The usual reason is
 * that S3 should not be a compile-time dependency of the module that reviews a
 * driver's licence. The specific one is that **the bytes never pass through
 * this API**: a browser uploads straight to storage with a pre-signed URL, and
 * a reviewer downloads the same way. That is a deliberate shape, and it is
 * easier to hold onto when it is written down as an interface than when it is
 * an SDK call in a service.
 *
 * Why the bytes are kept out of the process at all:
 *
 *   - **Memory.** A multipart body through Node is a copy of the file in the
 *     heap of an API that is also holding open WebSockets for every live ride.
 *   - **Blast radius.** An API that can stream any object is an API where a
 *     path-traversal bug hands over the whole bucket. One that only mints a
 *     URL for one key, after an authorisation check, cannot.
 *   - **Cost and latency.** A 5 MB photograph does not need to make two trips.
 */

export interface PresignedUpload {
  /** Where to PUT the bytes. Short-lived. */
  url: string;

  /**
   * Headers the client must send with the PUT, exactly as given.
   *
   * The signature covers them, so a client that omits or alters one gets a
   * 403 from storage. That is the mechanism that stops an upload authorised as
   * a 4 MB JPEG from becoming a 400 MB anything.
   */
  headers: Record<string, string>;

  expiresInSeconds: number;
}

export interface StoredObject {
  byteSize: number;
  contentType: string;
  /** The storage vendor's checksum, where it exposes one. */
  checksum: string | null;
}

export interface StoragePort {
  readonly driver: 's3' | 'filesystem';

  /**
   * A URL a client may PUT one object to, once, for a short time.
   *
   * `contentType` and `maxBytes` are part of the signature rather than advice.
   * An upload slot that does not bound what may be written to it is an open
   * bucket with extra steps.
   */
  presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload>;

  /**
   * A URL a reviewer may GET one object from, for a short time.
   *
   * Deliberately short. A link to a driver's licence that works for a week is
   * a link that ends up in a chat message, an email thread and a browser
   * history, and none of those is a place this file may live.
   */
  presignDownload(input: { key: string; expiresInSeconds?: number }): Promise<string>;

  /**
   * What is actually stored at this key, or null if nothing is.
   *
   * The upload happens out of band, so this is how the API learns that it
   * finished — and it is also the check that the object matches what was
   * authorised. A client that presents a completed upload it never made has
   * to be caught here or not at all.
   */
  head(key: string): Promise<StoredObject | null>;

  /** Removes an object. Used by retention, and by a rejected re-upload. */
  remove(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');
