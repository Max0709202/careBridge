import { normalizeE164 } from './phone';

describe('normalizeE164', () => {
  it.each([
    ['(555) 010-0100', '+15550100100'],
    ['555.010.0100', '+15550100100'],
    ['1-555-010-0100', '+15550100100'],
    ['+1 555 010 0100', '+15550100100'],
    ['+1-555-0100', null], // seven digits after the country code: not a US number
    ['555-010-0100 ext 22', '+15550100100'],
    ['555-010-0100 x22', '+15550100100'],
    ['+44 20 7946 0000', '+442079460000'],
    ['0044 20 7946 0000', '+442079460000'],
  ])('%s → %s (default +1)', (raw, expected) => {
    expect(normalizeE164(raw, '1')).toBe(expected);
  });

  it('applies another default country and drops a trunk zero', () => {
    expect(normalizeE164('020 7946 0000', '44')).toBe('+442079460000');
  });

  it.each([
    [''],
    ['   '],
    [null],
    [undefined],
    ['call my daughter'],
    ['12345'],
    ['+1234567890123456'],
    ['+0 20 7946 0000'], // no country code starts with zero
  ])('refuses %p', (raw) => {
    expect(normalizeE164(raw, '1')).toBeNull();
  });

  it('never turns a short US number into a different real one', () => {
    // Ten digits is the only national length; nine must not be padded into one.
    expect(normalizeE164('555 010 010', '1')).toBeNull();
  });
});
