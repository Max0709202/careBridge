import { distanceMiles, estimateDriveMinutes, lerp } from './geo';

describe('distanceMiles', () => {
  // Two points about 3.1 straight-line miles apart in the demo city.
  const clinic = { latitude: 37.7749, longitude: -122.4194 };
  const home = { latitude: 37.7649, longitude: -122.3694 };

  it('is zero for a point and itself', () => {
    expect(distanceMiles(clinic, clinic)).toBe(0);
  });

  it('is symmetric', () => {
    expect(distanceMiles(clinic, home)).toBeCloseTo(distanceMiles(home, clinic), 10);
  });

  it('applies the detour factor to the great-circle distance', () => {
    // Roads bend; the straight line is a floor, never the answer. Stated as a
    // ratio so the assertion survives the numbers changing.
    const straight = distanceMiles(clinic, home, 1);
    expect(distanceMiles(clinic, home, 1.3) / straight).toBeCloseTo(1.3, 10);
    expect(distanceMiles(clinic, home)).toBeGreaterThan(straight);
  });

  it('holds up across the antimeridian', () => {
    // Longitudes either side of ±180 are a fifth of a degree apart, not 359.8.
    // Getting this wrong is invisible until a deployment crosses it.
    const west = { latitude: 0, longitude: 179.9 };
    const east = { latitude: 0, longitude: -179.9 };
    expect(distanceMiles(west, east, 1)).toBeLessThan(15);
  });

  it('measures a pole-to-pole trip as half the circumference', () => {
    const distance = distanceMiles(
      { latitude: 90, longitude: 0 },
      { latitude: -90, longitude: 0 },
      1,
    );
    expect(distance).toBeCloseTo(Math.PI * 3958.8, 5);
  });
});

describe('estimateDriveMinutes', () => {
  it('is zero for a distance of zero', () => {
    expect(estimateDriveMinutes(0)).toBe(0);
  });

  it('is zero rather than negative for a negative distance', () => {
    // Not reachable from distanceMiles, which cannot return one — this is the
    // guard that keeps a bad caller from producing an ETA in the past.
    expect(estimateDriveMinutes(-5)).toBe(0);
  });

  it('adds a boarding buffer and rounds up', () => {
    // 6 miles at 24mph is exactly 15 minutes, plus the 6-minute buffer.
    expect(estimateDriveMinutes(6)).toBe(21);
    // 6.1 miles is 15.25 minutes, which rounds up rather than down: an
    // estimate that runs early costs a family nothing, one that runs late
    // costs them the appointment.
    expect(estimateDriveMinutes(6.1)).toBe(22);
  });

  it('never returns less than the buffer for any real trip', () => {
    expect(estimateDriveMinutes(0.01)).toBeGreaterThanOrEqual(6);
  });

  it('goes faster on a higher average speed', () => {
    expect(estimateDriveMinutes(24, 48)).toBeLessThan(estimateDriveMinutes(24, 24));
  });
});

describe('lerp', () => {
  const a = { latitude: 10, longitude: 20 };
  const b = { latitude: 20, longitude: 40 };

  it('returns the endpoints at 0 and 1', () => {
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
  });

  it('returns the midpoint at 0.5', () => {
    expect(lerp(a, b, 0.5)).toEqual({ latitude: 15, longitude: 30 });
  });
});
