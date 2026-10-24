import { ValidationError } from '../common/errors';
import {
  isWithinServiceArea,
  parseServiceArea,
  pickupCoverage,
  type ServiceArea,
} from './service-area';

// Downtown San Francisco, and two points roughly 3 and 20 miles away.
const depot = { latitude: 37.7749, longitude: -122.4194 };
const nearby = { latitude: 37.7649, longitude: -122.3694 };
const faraway = { latitude: 37.5485, longitude: -122.0589 };

describe('parseServiceArea', () => {
  it('accepts a radius', () => {
    expect(
      parseServiceArea({ kind: 'radius', center: depot, radiusMiles: 15 }),
    ).toEqual({
      kind: 'radius',
      center: depot,
      radiusMiles: 15,
    });
  });

  it('accepts a polygon and drops unknown fields', () => {
    const area = parseServiceArea({
      kind: 'polygon',
      points: [
        { latitude: 0, longitude: 0, label: 'x' },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 0 },
      ],
    });
    expect(area).toEqual({
      kind: 'polygon',
      points: [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
        { latitude: 1, longitude: 0 },
      ],
    });
  });

  it.each([
    ['nothing', undefined, 'kind'],
    ['an unknown kind', { kind: 'zip' }, 'kind'],
    ['a zero radius', { kind: 'radius', center: depot, radiusMiles: 0 }, 'radiusMiles'],
    [
      'a huge radius',
      { kind: 'radius', center: depot, radiusMiles: 5000 },
      'radiusMiles',
    ],
    ['a missing centre', { kind: 'radius', radiusMiles: 5 }, 'center'],
    [
      'an impossible latitude',
      { kind: 'radius', center: { latitude: 91, longitude: 0 }, radiusMiles: 5 },
      'center',
    ],
    ['two points', { kind: 'polygon', points: [depot, nearby] }, 'points'],
    [
      'points on one line',
      {
        kind: 'polygon',
        points: [
          { latitude: 0, longitude: 0 },
          { latitude: 1, longitude: 1 },
          { latitude: 2, longitude: 2 },
        ],
      },
      'points',
    ],
  ])('refuses %s', (_label, input, field) => {
    try {
      parseServiceArea(input);
      throw new Error('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe(field);
    }
  });
});

describe('isWithinServiceArea', () => {
  const radius: ServiceArea = { kind: 'radius', center: depot, radiusMiles: 10 };

  it('includes points within the radius and excludes those beyond it', () => {
    expect(isWithinServiceArea(radius, depot)).toBe(true);
    expect(isWithinServiceArea(radius, nearby)).toBe(true);
    expect(isWithinServiceArea(radius, faraway)).toBe(false);
  });

  it('measures the radius as the crow flies, not by road', () => {
    // ~2.8 straight-line miles; the 1.3 road detour would put it past 3.
    expect(
      isWithinServiceArea({ kind: 'radius', center: depot, radiusMiles: 3 }, nearby),
    ).toBe(true);
  });

  // An L shape, so a point in the notch is inside the bounding box but outside
  // the area — the case a bounding-box shortcut gets wrong.
  const lShape: ServiceArea = {
    kind: 'polygon',
    points: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 2 },
      { latitude: 1, longitude: 2 },
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 1 },
      { latitude: 2, longitude: 0 },
    ],
  };

  it('follows the outline of a polygon', () => {
    expect(isWithinServiceArea(lShape, { latitude: 0.5, longitude: 0.5 })).toBe(true);
    expect(isWithinServiceArea(lShape, { latitude: 0.5, longitude: 1.5 })).toBe(true);
    expect(isWithinServiceArea(lShape, { latitude: 1.5, longitude: 0.5 })).toBe(true);
    expect(isWithinServiceArea(lShape, { latitude: 1.5, longitude: 1.5 })).toBe(false);
    expect(isWithinServiceArea(lShape, { latitude: 3, longitude: 3 })).toBe(false);
  });

  it('does not care which way the outline was drawn', () => {
    const reversed: ServiceArea = {
      kind: 'polygon',
      points: [...lShape.points].reverse(),
    };
    expect(isWithinServiceArea(reversed, { latitude: 0.5, longitude: 1.5 })).toBe(true);
    expect(isWithinServiceArea(reversed, { latitude: 1.5, longitude: 1.5 })).toBe(
      false,
    );
  });
});

describe('pickupCoverage', () => {
  const area: ServiceArea = { kind: 'radius', center: depot, radiusMiles: 10 };

  it('is unknown without an area or without a located pickup', () => {
    expect(pickupCoverage(null, nearby)).toBeNull();
    expect(pickupCoverage(area, { latitude: null, longitude: null })).toBeNull();
  });

  it('answers when both are known', () => {
    expect(pickupCoverage(area, nearby)).toBe(true);
    expect(pickupCoverage(area, faraway)).toBe(false);
  });
});
