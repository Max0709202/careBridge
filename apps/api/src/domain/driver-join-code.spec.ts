import {
  formatJoinCode,
  generateJoinCode,
  normalizeJoinCode,
} from './driver-join-code';

describe('driver join codes', () => {
  it('generates eight characters with no look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(normalizeJoinCode(code)).toBe(code);
    }
  });

  it('formats as two groups of four', () => {
    expect(formatJoinCode('K7QM2RXD')).toBe('K7QM-2RXD');
  });

  it.each([
    ['K7QM-2RXD', 'K7QM2RXD'],
    ['k7qm 2rxd', 'K7QM2RXD'],
    ['  K7QM2RXD ', 'K7QM2RXD'],
  ])('accepts %p', (raw, expected) => {
    expect(normalizeJoinCode(raw)).toBe(expected);
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['K7QM-2RX'],
    ['K7QM-2RXDD'],
    ['K0QM-2RXD'],
    ['K7QM-2R!D'],
  ])('refuses %p', (raw) => {
    expect(normalizeJoinCode(raw)).toBeNull();
  });
});
