import { __testing } from './invitations.service';

const { maskEmail, firstNameOf } = __testing;

describe('invitation email masking', () => {
  it('leaves the first character and the domain readable', () => {
    // Enough for the invitee to recognise their own address in a list; not
    // enough for the rest of the care circle to harvest one.
    expect(maskEmail('adaokonkwo@example.com')).toBe('a•••••••••@example.com');
    expect(maskEmail('sam@clinic.org')).toBe('s••@clinic.org');
  });

  it('never reveals a one-character local part in full', () => {
    // 'a@x.com' masked naively is 'a@x.com' — unchanged, and unmasked.
    expect(maskEmail('a@example.com')).toBe('a•@example.com');
  });

  it('does not fall over on an address with no domain', () => {
    expect(() => maskEmail('malformed')).not.toThrow();
  });
});

describe('inviter first name', () => {
  it('is the first word, which is what the recipient needs to recognise', () => {
    expect(firstNameOf('Ada Okonkwo')).toBe('Ada');
    expect(firstNameOf('  Marie   Curie-Skłodowska ')).toBe('Marie');
  });

  it('degrades to something addressable rather than an empty greeting', () => {
    expect(firstNameOf('')).toBe('Someone');
    expect(firstNameOf('   ')).toBe('Someone');
  });
});
