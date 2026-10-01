import { createHmac } from 'node:crypto';

import { TwilioTelephonyAdapter } from './twilio-telephony.adapter';

const adapter = new TwilioTelephonyAdapter({
  accountSid: 'AC123',
  authToken: 'test-auth-token',
  webhookBaseUrl: 'https://carebridge.example/api/v1/',
});

function sign(
  url: string,
  params: Record<string, string>,
  token = 'test-auth-token',
): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
  return createHmac('sha1', token).update(payload).digest('base64');
}

describe('TwilioTelephonyAdapter', () => {
  const pathAndQuery = '/telephony/status?session=s-1&leg=callee';
  const params = { CallSid: 'CA1', CallStatus: 'ringing' };

  it('accepts a webhook signed over the configured public URL', () => {
    const signature = sign(`https://carebridge.example/api/v1${pathAndQuery}`, params);
    expect(adapter.verifyWebhook({ pathAndQuery, params, signature })).toBe(true);
  });

  it('refuses a missing, forged or re-targeted signature', () => {
    expect(adapter.verifyWebhook({ pathAndQuery, params, signature: undefined })).toBe(
      false,
    );
    expect(
      adapter.verifyWebhook({
        pathAndQuery,
        params,
        signature: sign(
          `https://carebridge.example/api/v1${pathAndQuery}`,
          params,
          'wrong',
        ),
      }),
    ).toBe(false);
    // A valid signature for another session must not move this one.
    const other = sign(
      'https://carebridge.example/api/v1/telephony/status?session=s-2&leg=callee',
      params,
    );
    expect(adapter.verifyWebhook({ pathAndQuery, params, signature: other })).toBe(
      false,
    );
    // Nor with a changed parameter.
    const signature = sign(`https://carebridge.example/api/v1${pathAndQuery}`, params);
    expect(
      adapter.verifyWebhook({
        pathAndQuery,
        params: { ...params, CallStatus: 'completed' },
        signature,
      }),
    ).toBe(false);
  });

  it('maps each leg to the call state machine', () => {
    expect(adapter.readStatus('s', 'caller', { CallStatus: 'ringing' })?.status).toBe(
      'ringingCaller',
    );
    expect(
      adapter.readStatus('s', 'caller', { CallStatus: 'in-progress' })?.status,
    ).toBe('ringingCallee');
    expect(adapter.readStatus('s', 'caller', { CallStatus: 'no-answer' })?.status).toBe(
      'canceled',
    );
    expect(
      adapter.readStatus('s', 'callee', { CallStatus: 'in-progress' })?.status,
    ).toBe('inProgress');
    expect(adapter.readStatus('s', 'callee', { CallStatus: 'completed' })).toBeNull();
    expect(
      adapter.readStatus('s', 'dial', { DialCallStatus: 'no-answer' })?.status,
    ).toBe('noAnswer');
    expect(
      adapter.readStatus('s', 'dial', {
        DialCallStatus: 'completed',
        DialCallDuration: '185',
      }),
    ).toEqual({
      callSessionId: 's',
      status: 'completed',
      durationSeconds: 185,
    });
  });

  it('dials the callee from the relay number, and records nothing', () => {
    const reply = adapter.bridgeReply('s-1', '+15550100100', '+15550109999');
    expect(reply.contentType).toBe('text/xml');
    expect(reply.body).toContain('callerId="+15550109999"');
    expect(reply.body).toContain('<Number');
    expect(reply.body).toContain('+15550100100</Number>');
    expect(reply.body).toContain('session=s-1&amp;leg=callee');
    expect(reply.body.toLowerCase()).not.toContain('record');
  });

  it('apologises rather than dialling nobody', () => {
    expect(adapter.bridgeReply('s-1', null, '+15550109999').body).not.toContain(
      '<Dial',
    );
  });
});
