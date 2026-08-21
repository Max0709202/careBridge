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

describe('routing without a vendor', () => {
  const adapter = new DeterministicMapsAdapter();
  const house = { latitude: 40.651, longitude: -73.958 };
  const clinic = { latitude: 40.6558, longitude: -73.945 };

  it('gives a city-sized answer for a city-sized journey', async () => {
    const route = await adapter.route(house, clinic);

    expect(route.distanceMiles).toBeGreaterThan(0.5);
    expect(route.distanceMiles).toBeLessThan(3);
    expect(route.durationMinutes).toBeGreaterThan(1);
    expect(route.durationMinutes).toBeLessThan(15);
  });

  it('says which adapter produced it', () => {
    // The third property that makes this more than a mock: nothing downstream
    // can mistake a straight line for a traffic-aware route.
    return expect(adapter.route(house, clinic)).resolves.toMatchObject({
      source: 'deterministic',
    });
  });

  it('gives the same answer every time, on every machine', async () => {
    const first = await adapter.route(house, clinic);
    const second = await adapter.route(house, clinic);

    expect(first).toEqual(second);
  });

  it('never returns zero minutes for two different places', async () => {
    // An ETA of zero renders as "arriving now" beside a car that has not
    // moved, which is the one thing a tracking screen must not say.
    const nextDoor = { latitude: 40.65101, longitude: -73.95801 };
    expect((await adapter.route(house, nextDoor)).durationMinutes).toBe(1);
  });

  it('leaves out the boarding buffer the fare estimate carries', async () => {
    // The fare estimate answers "how long does the whole trip take". A live
    // countdown answers "when does the car arrive", and six minutes of
    // boarding on every ETA would be a permanent lie.
    const nearby = { latitude: 40.6515, longitude: -73.9585 };
    expect((await adapter.route(house, nearby)).durationMinutes).toBeLessThan(6);
  });

  it('does not throw, because there is no vendor to be unavailable', async () => {
    await expect(adapter.route(house, house)).resolves.toBeDefined();
  });
});
