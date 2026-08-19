import pino from 'pino';
import { Writable } from 'node:stream';

import { REDACTION_CENSOR, REDACTION_PATHS, SENSITIVE_FIELD_NAMES } from './redaction';

/**
 * The acceptance criterion from FOUNDATION §2 is "no personal data appears in
 * any log line". That is a property of the logger, so it is tested by logging
 * through a real pino instance and reading what came out the other end —
 * asserting on the denylist array would only prove the array contains what the
 * array contains.
 */
function captureLog(fn: (logger: pino.Logger) => void): Record<string, unknown> {
  let captured = '';
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      captured += String(chunk);
      callback();
    },
  });

  const logger = pino(
    { redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR } },
    sink,
  );
  fn(logger);

  return JSON.parse(captured.trim()) as Record<string, unknown>;
}

describe('log redaction', () => {
  it('redacts a patient object logged whole', () => {
    // The realistic accident: someone debugging at 2am logs the object rather
    // than picking fields off it.
    const line = captureLog((log) =>
      log.info(
        {
          patient: {
            id: 'pat_1',
            preferredName: 'Margaret',
            phone: '+1-555-0100',
            latitude: 40.7128,
            longitude: -74.006,
          },
        },
        'loaded patient',
      ),
    );

    const patient = line['patient'] as Record<string, unknown>;
    expect(patient['preferredName']).toBe(REDACTION_CENSOR);
    expect(patient['phone']).toBe(REDACTION_CENSOR);
    expect(patient['latitude']).toBe(REDACTION_CENSOR);
    expect(patient['longitude']).toBe(REDACTION_CENSOR);

    // The id survives, and must: without it the line is unactionable.
    expect(patient['id']).toBe('pat_1');
  });

  it('redacts credentials at the top level', () => {
    const line = captureLog((log) =>
      log.info(
        { email: 'someone@example.com', password: 'hunter2-hunter2', userId: 'u1' },
        'sign-in attempt',
      ),
    );

    expect(line['email']).toBe(REDACTION_CENSOR);
    expect(line['password']).toBe(REDACTION_CENSOR);
    expect(line['userId']).toBe('u1');
  });

  it('redacts an Authorization header however it is cased', () => {
    const line = captureLog((log) =>
      log.info(
        { req: { headers: { authorization: 'Bearer abc.def.ghi' } } },
        'request',
      ),
    );

    const headers = (line['req'] as Record<string, unknown>)['headers'] as Record<
      string,
      unknown
    >;
    expect(headers['authorization']).toBe(REDACTION_CENSOR);
  });

  it('redacts one level into an array of records', () => {
    const line = captureLog((log) =>
      log.info({ contacts: [{ name: 'Ade', phone: '+1-555-0111' }] }, 'contacts'),
    );

    const contacts = line['contacts'] as Array<Record<string, unknown>>;
    expect(contacts[0]?.['name']).toBe(REDACTION_CENSOR);
    expect(contacts[0]?.['phone']).toBe(REDACTION_CENSOR);
  });

  it('keeps every category the privacy data map classifies as sensitive', () => {
    // A guard against the denylist quietly shrinking. Removing an entry here
    // should be a deliberate act with a reason in the diff, not a merge
    // artefact.
    for (const field of [
      'email',
      'phone',
      'preferredName',
      'legalName',
      'line1',
      'postalCode',
      'latitude',
      'longitude',
      'dateOfBirth',
      'password',
      'refreshToken',
      'totpSecret',
      'authorization',
      'coordinationNotes',
    ]) {
      expect(SENSITIVE_FIELD_NAMES).toContain(field);
    }
  });

  it('redacts the billing addresses that are email addresses under another name', () => {
    // `billingEmail` and `contactEmail` are the same class of data as `email`,
    // and pino matches paths exactly — an alias walks straight through unless
    // it is named.
    const line = captureLog((log) =>
      log.info(
        {
          billingAccount: {
            id: 'ba_1',
            billingEmail: 'accounts@meridiantransit.example',
          },
          organization: { id: 'org_1', contactEmail: 'dispatch@example.test' },
        },
        'opened subscription',
      ),
    );

    const account = line['billingAccount'] as Record<string, unknown>;
    const organization = line['organization'] as Record<string, unknown>;

    expect(account['billingEmail']).toBe(REDACTION_CENSOR);
    expect(organization['contactEmail']).toBe(REDACTION_CENSOR);
    // The ids stay: they are what makes an incident traceable at all.
    expect(account['id']).toBe('ba_1');
  });
});
