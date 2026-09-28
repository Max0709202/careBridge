import { describe, expect, it } from 'vitest';

import { DriverApi } from '../src/api/driverApi';
import { Failure } from '../src/api/failures';
import { InMemoryTokenStore } from '../src/api/tokens';
import { documents } from './support/fixtures';

const BASE = 'http://localhost/api/v1';

function setup(storageStatus = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('https://storage.example')) return new Response(null, { status: storageStatus });
    if (url.endsWith('/driver/documents/confirm')) return Response.json(documents());
    return Response.json({});
  };
  const tokens = new InMemoryTokenStore();
  tokens.write({ accessToken: 'secret-access', refreshToken: 'r' });
  return { api: new DriverApi(tokens, BASE, fetcher), calls };
}

const slot = {
  documentId: 'doc-9',
  url: 'https://storage.example/bucket/doc-9?sig=abc',
  headers: { 'Content-Type': 'image/jpeg', 'x-amz-meta-kind': 'driversLicence' },
  expiresInSeconds: 600,
  maxBytes: 1024,
};

describe('uploading a document', () => {
  it('sends the bytes with exactly the headers that were signed, and never the session', async () => {
    const { api, calls } = setup();
    await api.uploadBytes(slot, new Blob(['x'], { type: 'image/jpeg' }));
    const put = calls[0]!;
    expect(put.init.method).toBe('PUT');
    expect(put.init.headers).toEqual(slot.headers);
    expect(put.init.credentials).toBe('omit');
    expect(JSON.stringify(put.init.headers)).not.toContain('secret-access');
  });

  it('reports a storage refusal as a failure, not as success', async () => {
    const { api } = setup(403);
    await expect(api.uploadBytes(slot, new Blob(['x']))).rejects.toBeInstanceOf(Failure);
  });

  it('refuses a file larger than the slot before sending it', async () => {
    const { api, calls } = setup();
    await expect(api.uploadBytes(slot, new Blob([new Uint8Array(2048)]))).rejects.toBeInstanceOf(Failure);
    expect(calls).toHaveLength(0);
  });
});

describe('moving a ride along', () => {
  it('is idempotency-keyed', async () => {
    const { api, calls } = setup();
    await api.advance('ride-1', 'driverArrived').catch(() => undefined);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(`${BASE}/driver/rides/ride-1/advance`);
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
