import { decodePolyline, thinPath } from './polyline';

/** The reference encoder, for building inputs the decoder must refuse. */
function encode(points: Array<[number, number]>): string {
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const [lat, lon] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lonE5 = Math.round(lon * 1e5);
    out += encodeValue(latE5 - prevLat) + encodeValue(lonE5 - prevLon);
    prevLat = latE5;
    prevLon = lonE5;
  }
  return out;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

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

  it('agrees with the reference encoder', () => {
    expect(
      decodePolyline(
        encode([
          [37.7749, -122.4194],
          [37.7649, -122.3694],
        ]),
      ),
    ).toEqual([
      { latitude: 37.7749, longitude: -122.4194 },
      { latitude: 37.7649, longitude: -122.3694 },
    ]);
  });

  it('refuses a point off the globe rather than drawing it', () => {
    expect(
      decodePolyline(
        encode([
          [10, 10],
          [95, 10],
        ]),
      ),
    ).toBeNull();
  });

  it('refuses a value that runs on past 32 bits', () => {
    // '~' is a continuation byte with every payload bit set: it never ends.
    expect(decodePolyline('~~~~~~~~~~')).toBeNull();
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

  it('caps at 500 points unless told otherwise', () => {
    expect(thinPath(path)).toHaveLength(500);
  });

  it('caps a long one, keeping both ends', () => {
    const thinned = thinPath(path, 500);
    expect(thinned).toHaveLength(500);
    expect(thinned[0]).toEqual(path[0]);
    expect(thinned[499]).toEqual(path[1000]);
  });
});
