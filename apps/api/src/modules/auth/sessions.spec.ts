import { SessionsService } from './sessions.service';

describe('device labels', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      'iPhone · Safari',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Android · Chrome',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mac · Chrome',
    ],
    ['CareBridge/0.2.0 (Android 14)', 'Android · CareBridge app'],
  ])('describes %s', (userAgent, expected) => {
    expect(SessionsService.describeDevice(userAgent)).toBe(expected);
  });

  it('never throws on a missing or nonsense user agent', () => {
    // The session list must render for a client that sends no User-Agent at
    // all; "Unknown device" is a usable row, an exception is not.
    expect(SessionsService.describeDevice(null)).toBe('Unknown device');
    expect(SessionsService.describeDevice('')).toBe('Unknown device');
    expect(SessionsService.describeDevice('-')).toBe('Unknown device');
  });
});
