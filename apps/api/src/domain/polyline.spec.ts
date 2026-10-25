import { decodePolyline, thinPath } from './polyline';

describe('decodePolyline', () => {
  it("decodes Google's documented example", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it('refuses a truncated or malformed string rather than returning half a road', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqN')).toBeNull();
    expect(decodePolyline('_p~iF~ps|U _ulLnnqC')).toBeNull();
    expect(decodePolyline('')).toBeNull();
  });

  it('refuses a single point, which is not a route', () => {
    expect(decodePolyline('_p~iF~ps|U')).toBeNull();
  });
});

describe('thinPath', () => {
  const path = Array.from({ length: 1001 }, (_, i) => ({
    latitude: i / 1000,
    longitude: 0,
  }));

  it('leaves a short path alone', () => {
    expect(thinPath(path.slice(0, 10), 500)).toHaveLength(10);
  });

  it('caps a long one, keeping both ends', () => {
    const thinned = thinPath(path, 500);
    expect(thinned).toHaveLength(500);
    expect(thinned[0]).toEqual(path[0]);
    expect(thinned[499]).toEqual(path[1000]);
  });
});
