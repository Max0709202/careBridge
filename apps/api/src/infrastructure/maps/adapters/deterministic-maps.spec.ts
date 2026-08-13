import { DeterministicMapsAdapter } from './deterministic-maps.adapter';

const adapter = new DeterministicMapsAdapter();

const clinic = {
  line1: '400 Parkside Avenue',
  city: 'Brooklyn',
  state: 'NY',
  postalCode: '11226',
};

describe('deterministic geocoding', () => {
  it('returns the same coordinates for the same address, every time', async () => {
    // This is the property the whole adapter exists for: a test can assert on
    // a distance, and a seeded demo shows every developer the same map.
    const first = await adapter.geocode(clinic);
    const second = await adapter.geocode(clinic);

    expect(first).toEqual(second);
  });

  it('ignores casing and incidental whitespace', async () => {
    const messy = await adapter.geocode({
      line1: '  400   PARKSIDE avenue ',
      city: 'brooklyn',
      state: 'ny',
      postalCode: ' 11226 ',
    });

    expect(messy).toEqual(await adapter.geocode(clinic));
  });

  it('separates two addresses that differ only by house number', async () => {
    const other = await adapter.geocode({ ...clinic, line1: '401 Parkside Avenue' });
    expect(other?.latitude).not.toBe((await adapter.geocode(clinic))?.latitude);
  });

  it('lands inside the state named in the address', async () => {
    // Plausibility is the point. A pin in the Gulf of Guinea makes a demo look
    // broken and makes a distance calculation meaningless.
    const result = await adapter.geocode(clinic);

    expect(result?.latitude).toBeGreaterThan(40.5);
    expect(result?.latitude).toBeLessThan(45.0);
    expect(result?.longitude).toBeGreaterThan(-79.8);
    expect(result?.longitude).toBeLessThan(-71.9);
  });

  it('falls back to the national box for a state it does not know', async () => {
    const result = await adapter.geocode({ ...clinic, state: 'ZZ' });

    expect(result?.latitude).toBeGreaterThan(25.8);
    expect(result?.latitude).toBeLessThan(49.0);
  });

  it('never claims better than approximate precision', async () => {
    // Nothing downstream may mistake a hash for a rooftop fix.
    const result = await adapter.geocode(clinic);

    expect(result?.precision).toBe('approximate');
    expect(result?.source).toBe('deterministic');
  });

  it('returns null for an address with nothing in it', async () => {
    expect(
      await adapter.geocode({ line1: '', city: '', state: '', postalCode: '' }),
    ).toBeNull();
  });
});
