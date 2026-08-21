import { TestHarness, errorOf } from './support/harness';
import {
  authed,
  registerUser,
  uniqueEmail,
  verifyEmail,
  type TestUser,
} from './support/factories';
import { expectsIndistinguishableDenial } from './support/negative-paths';
import { MAX_DOCUMENT_BYTES } from '../src/domain/driver-documents';

/**
 * Driver documents, end to end.
 *
 * The file being uploaded is a licence scan: a home address, a date of birth
 * and a photograph, which are the three things this product otherwise refuses
 * to store. Everything asserted here follows from that. The bytes never pass
 * through the API. The link expires. Looking at one is audited. And nobody
 * gets approved to carry a passenger until the paperwork is actually there —
 * checked on the server, not by the button.
 */
let organizationSequence = 0;
let plateSequence = 0;

describe('driver documents', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.create();
  });

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  // ─── fixtures ─────────────────────────────────────────────────────────────

  async function operatorWithDriver(): Promise<{
    owner: TestUser;
    driver: TestUser;
    organizationId: string;
    driverId: string;
  }> {
    const owner = await registerUser(harness);

    const organization = await harness.prisma.organization.create({
      data: {
        name: 'Meridian Transit Partners',
        slug: `meridian-${(organizationSequence += 1).toString(36)}-${Date.now().toString(36)}`,
        contactEmail: 'dispatch@meridiantransit.example',
      },
    });
    await harness.prisma.organizationMembership.create({
      data: { userId: owner.userId, organizationId: organization.id, role: 'owner' },
    });
    await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/billing/subscribe`)
      .send({ planCode: 'dispatch-core', interval: 'monthly' })
      .expect(201);

    const vehicle = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/vehicles`)
      .send({
        make: 'Toyota',
        model: 'Sienna',
        color: 'Silver',
        licensePlate: `OH-${(plateSequence += 1).toString().padStart(4, '0')}`,
        isWheelchairAccessible: true,
      })
      .expect(201);

    const email = uniqueEmail('driver');
    const driver = await registerUser(harness, { email });
    await verifyEmail(harness, driver.userId);

    const created = await authed(harness, owner.accessToken)
      .post(`/api/v1/organizations/${organization.id}/drivers`)
      .send({
        displayName: 'Marcus T.',
        vehicleId: (vehicle.body as { id: string }).id,
        email,
      })
      .expect(201);

    return {
      owner,
      driver,
      organizationId: organization.id,
      driverId: (created.body as { id: string }).id,
    };
  }

  /** The whole client-side dance: authorise, PUT the bytes, confirm. */
  async function upload(
    driver: TestUser,
    kind: string,
    options: { expiresAt?: string; bytes?: Buffer } = {},
  ): Promise<string> {
    const authorised = await authed(harness, driver.accessToken)
      .post('/api/v1/driver/documents')
      .send({
        kind,
        contentType: 'image/jpeg',
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      })
      .expect(201);

    const slot = authorised.body as {
      documentId: string;
      url: string;
      headers: Record<string, string>;
    };

    await putBytes(slot.url, options.bytes ?? Buffer.from('a photograph of a licence'));

    await authed(harness, driver.accessToken)
      .post('/api/v1/driver/documents/confirm')
      .send({ documentId: slot.documentId })
      .expect(201);

    return slot.documentId;
  }

  /**
   * PUTs to a pre-signed URL.
   *
   * The URL is absolute and points at this same API when the filesystem
   * adapter is live, so the path is extracted and sent back through supertest
   * rather than opening a real socket.
   */
  async function putBytes(url: string, body: Buffer) {
    return harness.http
      .put(pathOf(url))
      .set('content-type', 'image/jpeg')
      .send(body)
      .expect(200);
  }

  function pathOf(url: string): string {
    return new URL(url).pathname;
  }

  function review(
    owner: TestUser,
    organizationId: string,
    driverId: string,
    documentId: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    return authed(harness, owner.accessToken)
      .post(
        `/api/v1/organizations/${organizationId}/drivers/${driverId}/documents/${documentId}/review`,
      )
      .send({ decision, ...(note ? { note } : {}) });
  }

  async function approveAll(
    owner: TestUser,
    driver: TestUser,
    organizationId: string,
    driverId: string,
  ) {
    for (const kind of ['driversLicence', 'vehicleInsurance', 'vehicleRegistration']) {
      const documentId = await upload(driver, kind);
      await review(owner, organizationId, driverId, documentId, 'approved').expect(201);
    }
  }

  // ─── the upload ───────────────────────────────────────────────────────────

  describe('handing something in', () => {
    it('gives a URL to upload to rather than taking the bytes', async () => {
      // The API never holds the file. A multipart body would be a copy of a
      // photograph in the heap of a process that is also holding a WebSocket
      // open for every live ride.
      const { driver } = await operatorWithDriver();

      const response = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'driversLicence', contentType: 'image/jpeg' })
        .expect(201);

      const slot = response.body as {
        url: string;
        headers: Record<string, string>;
        expiresInSeconds: number;
        maxBytes: number;
      };
      expect(slot.url).toContain('/storage/local/');
      expect(slot.headers['content-type']).toBe('image/jpeg');
      expect(slot.maxBytes).toBe(MAX_DOCUMENT_BYTES);
      // Short-lived. A URL captured from a log or a browser history should be
      // dead before anybody could use it.
      expect(slot.expiresInSeconds).toBeLessThanOrEqual(900);
    });

    it('refuses a file type nobody scans a licence as', async () => {
      // An allow-list, not a deny-list. Anything outside it is a file somebody
      // is trying to put in a bucket for a different reason than the form.
      const { driver } = await operatorWithDriver();

      const response = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'driversLicence', contentType: 'application/zip' })
        .expect(400);

      expect(errorOf(response).message).toMatch(/photo or a PDF/i);
    });

    it('refuses a document kind that is not collected', async () => {
      // A transport operator has no business holding a driver's passport
      // because the form happened to allow one.
      const { driver } = await operatorWithDriver();

      await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'passport', contentType: 'image/jpeg' })
        .expect(400);
    });

    it('will not believe a client that says it uploaded', async () => {
      // The check that matters. A client reporting its own success could
      // report it without uploading anything, and an operator would then see a
      // complete file with an empty object behind the row.
      const { driver } = await operatorWithDriver();

      const authorised = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'driversLicence', contentType: 'image/jpeg' })
        .expect(201);

      const response = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents/confirm')
        .send({ documentId: (authorised.body as { documentId: string }).documentId })
        .expect(400);

      expect(errorOf(response).message).toMatch(/not received/i);
    });

    it('records the size and checksum from storage, not from the client', async () => {
      const { driver } = await operatorWithDriver();
      const bytes = Buffer.from('a photograph of a licence');
      const documentId = await upload(driver, 'driversLicence', { bytes });

      const row = await harness.prisma.driverDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      expect(row.status).toBe('submitted');
      expect(row.byteSize).toBe(bytes.byteLength);
      expect(row.checksum).not.toBeNull();
    });

    it('puts no readable identifier in the object key', async () => {
      // A bucket listing must not be a roster.
      const { driver, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');

      const row = await harness.prisma.driverDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      expect(row.storageKey).toContain(driverId);
      expect(row.storageKey).not.toContain('Marcus');
      expect(row.storageKey).not.toContain(driver.email);
    });

    it('supersedes the previous attempt rather than erasing it', async () => {
      // A renewal must not delete the certificate that covered last month's
      // rides. "Which one was in force in March" has to stay answerable.
      const { driver } = await operatorWithDriver();
      const first = await upload(driver, 'driversLicence');
      const second = await upload(driver, 'driversLicence');

      expect(second).not.toBe(first);
      const rows = await harness.prisma.driverDocument.findMany({
        where: { kind: 'driversLicence' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.supersededAt === null)).toHaveLength(1);
    });
  });

  // ─── the pre-signed URL itself ────────────────────────────────────────────

  describe('the upload link', () => {
    it('cannot be used twice', async () => {
      // Spent on first use, exactly like a pre-signed PUT.
      const { driver } = await operatorWithDriver();
      const authorised = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'driversLicence', contentType: 'image/jpeg' })
        .expect(201);

      const url = (authorised.body as { url: string }).url;
      await putBytes(url, Buffer.from('first'));

      await harness.http
        .put(pathOf(url))
        .set('content-type', 'image/jpeg')
        .send(Buffer.from('second'))
        .expect(404);
    });

    it('refuses a body of a different type than was authorised', async () => {
      // The content type is part of the signature in S3. The local adapter has
      // to check it explicitly or it would authorise differently.
      const { driver } = await operatorWithDriver();
      const authorised = await authed(harness, driver.accessToken)
        .post('/api/v1/driver/documents')
        .send({ kind: 'driversLicence', contentType: 'image/jpeg' })
        .expect(201);

      await harness.http
        .put(pathOf((authorised.body as { url: string }).url))
        .set('content-type', 'text/html')
        .send(Buffer.from('<script>'))
        .expect(400);
    });

    it('says nothing about a token it does not know', async () => {
      await harness.http
        .put('/api/v1/storage/local/not-a-real-token')
        .set('content-type', 'image/jpeg')
        .send(Buffer.from('x'))
        .expect(404);
    });
  });

  // ─── looking at one ───────────────────────────────────────────────────────

  describe('reviewing', () => {
    it('mints a short link and writes down who looked', async () => {
      // The audit row that matters most in the whole feature. "Who has seen
      // this" is the question an investigation asks, and it cannot be answered
      // after the fact.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');

      const response = await authed(harness, owner.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/drivers/${driverId}/documents/${documentId}/view`,
        )
        .expect(201);

      const view = response.body as { url: string; expiresInSeconds: number };
      expect(view.expiresInSeconds).toBeLessThanOrEqual(300);

      const audit = await harness.prisma.auditLog.findFirst({
        where: { action: 'driver.document_viewed', entityId: documentId },
      });
      expect(audit?.actorUserId).toBe(owner.userId);
    });

    it('serves the file as an attachment that cannot sniff', async () => {
      // This serves whatever a driver uploaded. A file that renders in the
      // browser is a file that can carry script on this API's own origin.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');

      const view = await authed(harness, owner.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/drivers/${driverId}/documents/${documentId}/view`,
        )
        .expect(201);

      const download = await harness.http
        .get(pathOf((view.body as { url: string }).url))
        .expect(200);

      expect(download.headers['content-disposition']).toBe('attachment');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['cache-control']).toBe('no-store');
    });

    it('will not let a download link be used to write', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');

      const view = await authed(harness, owner.accessToken)
        .post(
          `/api/v1/organizations/${organizationId}/drivers/${driverId}/documents/${documentId}/view`,
        )
        .expect(201);

      await harness.http
        .put(pathOf((view.body as { url: string }).url))
        .set('content-type', 'image/jpeg')
        .send(Buffer.from('replaced'))
        .expect(404);
    });

    it('insists a rejection says why', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');

      await review(owner, organizationId, driverId, documentId, 'rejected').expect(400);
      await review(
        owner,
        organizationId,
        driverId,
        documentId,
        'rejected',
        'The expiry date is not readable.',
      ).expect(201);
    });

    it('tells the driver why, in their own app', async () => {
      // Being told "you cannot drive" without being told which document and
      // why is how somebody re-uploads the same photograph three times.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');
      await review(
        owner,
        organizationId,
        driverId,
        documentId,
        'rejected',
        'The expiry date is not readable.',
      ).expect(201);

      const response = await authed(harness, driver.accessToken)
        .get('/api/v1/driver/documents')
        .expect(200);

      const body = response.body as {
        documents: Array<{ status: string; reviewNote: string | null }>;
      };
      const rejected = body.documents.find((d) => d.status === 'rejected');
      expect(rejected?.reviewNote).toBe('The expiry date is not readable.');
    });

    it('will not re-open a decision', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');
      await review(owner, organizationId, driverId, documentId, 'approved').expect(201);

      await review(
        owner,
        organizationId,
        driverId,
        documentId,
        'rejected',
        'changed my mind',
      ).expect(409);
    });

    it('answers another operator’s document exactly as one that does not exist', async () => {
      const { driver, organizationId, driverId } = await operatorWithDriver();
      const documentId = await upload(driver, 'driversLicence');
      const outsider = await operatorWithDriver();

      await expectsIndistinguishableDenial({
        token: outsider.owner.accessToken,
        forbidden: (token) =>
          authed(harness, token).post(
            `/api/v1/organizations/${organizationId}/drivers/${driverId}/documents/${documentId}/view`,
          ),
        missing: (token) =>
          authed(harness, token).post(
            `/api/v1/organizations/${outsider.organizationId}/drivers/${outsider.driverId}/documents/11111111-2222-3333-4444-555555555555/view`,
          ),
      });
    });
  });

  // ─── the gate ─────────────────────────────────────────────────────────────

  describe('approving a driver', () => {
    function moveTo(
      owner: TestUser,
      organizationId: string,
      driverId: string,
      to: string,
    ) {
      return authed(harness, owner.accessToken)
        .post(`/api/v1/organizations/${organizationId}/drivers/${driverId}/status`)
        .send({ to });
    }

    it('refuses until the paperwork is actually there', async () => {
      // Enforced on the server, inside the transaction. The console greys the
      // button out, but a check only a screen performs is one a second tab can
      // race past — and what it guards is whether somebody carries a passenger
      // uninsured.
      const { owner, organizationId, driverId } = await operatorWithDriver();
      await moveTo(owner, organizationId, driverId, 'pendingApproval').expect(201);

      const response = await moveTo(owner, organizationId, driverId, 'approved').expect(
        400,
      );
      expect(errorOf(response).message).toMatch(/driving licence/i);
      expect(errorOf(response).message).toMatch(/vehicle insurance/i);
    });

    it('names everything missing, not just the first', async () => {
      // "Nobody can be approved" and "the insurance is missing" need different
      // telephone calls.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      const licence = await upload(driver, 'driversLicence');
      await review(owner, organizationId, driverId, licence, 'approved').expect(201);
      await moveTo(owner, organizationId, driverId, 'pendingApproval').expect(201);

      const response = await moveTo(owner, organizationId, driverId, 'approved').expect(
        400,
      );
      expect(errorOf(response).message).not.toMatch(/driving licence/i);
      expect(errorOf(response).message).toMatch(/vehicle insurance/i);
      expect(errorOf(response).message).toMatch(/vehicle registration/i);
    });

    it('does not count a document nobody has reviewed', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      for (const kind of [
        'driversLicence',
        'vehicleInsurance',
        'vehicleRegistration',
      ]) {
        await upload(driver, kind);
      }
      await moveTo(owner, organizationId, driverId, 'pendingApproval').expect(201);

      await moveTo(owner, organizationId, driverId, 'approved').expect(400);
    });

    it('does not count an expired certificate', async () => {
      // The window between "expired" and "a sweep noticed" is a window in
      // which somebody drives uninsured with the system's blessing.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      for (const kind of ['driversLicence', 'vehicleRegistration']) {
        const id = await upload(driver, kind);
        await review(owner, organizationId, driverId, id, 'approved').expect(201);
      }
      const insurance = await upload(driver, 'vehicleInsurance', {
        expiresAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
      });
      await review(owner, organizationId, driverId, insurance, 'approved').expect(201);

      await moveTo(owner, organizationId, driverId, 'pendingApproval').expect(201);
      const response = await moveTo(owner, organizationId, driverId, 'approved').expect(
        400,
      );
      expect(errorOf(response).message).toMatch(/vehicle insurance/i);
    });

    it('lets an approval through once everything is in order', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      await approveAll(owner, driver, organizationId, driverId);
      await moveTo(owner, organizationId, driverId, 'pendingApproval').expect(201);

      await moveTo(owner, organizationId, driverId, 'approved').expect(201);

      const row = await harness.prisma.driver.findUniqueOrThrow({
        where: { id: driverId },
      });
      expect(row.status).toBe('approved');
    });

    it('does not require a background check', async () => {
      // A platform lookup is not what makes somebody safe, and treating it as
      // such would be a claim this product does not make. The operator decides
      // who to employ; the system enforces the legal minimum.
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      await approveAll(owner, driver, organizationId, driverId);

      const compliance = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/drivers/${driverId}/documents`)
        .expect(200);

      const body = compliance.body as { compliant: boolean; missing: string[] };
      expect(body.compliant).toBe(true);
      expect(body.missing).not.toContain('backgroundCheck');
    });

    it('warns before a certificate lapses rather than on the morning it does', async () => {
      const { owner, driver, organizationId, driverId } = await operatorWithDriver();
      for (const kind of ['driversLicence', 'vehicleRegistration']) {
        const id = await upload(driver, kind);
        await review(owner, organizationId, driverId, id, 'approved').expect(201);
      }
      const insurance = await upload(driver, 'vehicleInsurance', {
        expiresAt: new Date(Date.now() + 10 * 24 * 3600_000).toISOString(),
      });
      await review(owner, organizationId, driverId, insurance, 'approved').expect(201);

      const response = await authed(harness, owner.accessToken)
        .get(`/api/v1/organizations/${organizationId}/drivers/${driverId}/documents`)
        .expect(200);

      const body = response.body as { compliant: boolean; expiringSoon: string[] };
      expect(body.compliant).toBe(true);
      expect(body.expiringSoon).toEqual(['vehicleInsurance']);
    });
  });
});
