import { useEffect, useRef, useState } from 'react';

import type { Coordinates } from '../../domain/models';

/**
 * A schematic route view — **not** a map, and it does not pretend to be one.
 * No streets, no claim that the car is on a particular corner: pickup,
 * destination, and roughly where the vehicle is between them. When the
 * position goes stale the drawing dims and the marker hollows out, so "we have
 * lost contact" is visible at a glance. Port of route_map.dart, drawn as SVG.
 */
export function RouteMap(props: {
  pickup: Coordinates;
  destination: Coordinates;
  driver: Coordinates | null;
  isStale: boolean;
  passengerOnboard: boolean;
}) {
  // Drawn at the size it is shown, as a CustomPainter is, so the markers stay
  // round and the grid stays square on any width.
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const height = 240;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const inset = 44;

  const points = [props.pickup, props.destination, ...(props.driver ? [props.driver] : [])];
  const minLat = Math.min(...points.map((p) => p.latitude));
  const maxLat = Math.max(...points.map((p) => p.latitude));
  const minLng = Math.min(...points.map((p) => p.longitude));
  const maxLng = Math.max(...points.map((p) => p.longitude));

  const project = (c: Coordinates) => {
    const spanLat = maxLat - minLat;
    const spanLng = maxLng - minLng;
    const x = Math.abs(spanLng) < 1e-9 ? width / 2 : inset + ((c.longitude - minLng) / spanLng) * (width - inset * 2);
    // Latitude increases northwards; screen y increases downwards.
    const y = Math.abs(spanLat) < 1e-9 ? height / 2 : inset + ((maxLat - c.latitude) / spanLat) * (height - inset * 2);
    return { x, y };
  };

  const start = project(props.pickup);
  const end = project(props.destination);
  // A gentle curve rather than a straight line: a ruler-straight line reads as
  // a claim about the route that we are not making.
  const control = {
    x: (start.x + end.x) / 2 + (end.y - start.y) * 0.18,
    y: (start.y + end.y) / 2 - (end.x - start.x) * 0.18,
  };
  const vehicle = props.driver ? project(props.driver) : null;

  const label = props.driver
    ? `Route diagram showing the vehicle between pickup and destination.${props.isStale ? ' The position may be out of date.' : ''}`
    : 'Route diagram from pickup to destination. Vehicle position not available.';

  const grid = [];
  for (let x = 0; x < width; x += 28) grid.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} />);
  for (let y = 0; y < height; y += 28) grid.push(<line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} />);

  return (
    <svg
      ref={ref}
      className="route-map"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <g stroke="var(--on-surface)" strokeOpacity={0.04} strokeWidth={1}>
        {grid}
      </g>
      <path
        d={`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`}
        fill="none"
        stroke="var(--primary)"
        strokeOpacity={props.isStale ? 0.25 : 0.45}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <Endpoint at={start} label="Pickup" glyph="home" />
      <Endpoint at={end} label="Clinic" glyph="clinic" />
      {vehicle && <Vehicle at={vehicle} stale={props.isStale} onboard={props.passengerOnboard} />}
    </svg>
  );
}

function Endpoint({ at, label, glyph }: { at: { x: number; y: number }; label: string; glyph: 'home' | 'clinic' }) {
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={16} fill="var(--on-surface)" fillOpacity={0.1} stroke="var(--on-surface)" strokeOpacity={0.5} strokeWidth={2} />
      <g transform={`translate(${at.x - 8} ${at.y - 8})`} stroke="var(--on-surface)" strokeOpacity={0.75} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {glyph === 'home' ? (
          <path d="M2 8 L8 2.5 L14 8 M4 6.5 V14 H12 V6.5" />
        ) : (
          <path d="M8 3 V13 M3 8 H13" strokeWidth={3} />
        )}
      </g>
      <text x={at.x} y={at.y + 24 + 12} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--on-surface-variant)">
        {label}
      </text>
    </g>
  );
}

/** Hollow when stale: a filled marker for a position we no longer trust is false certainty. */
function Vehicle({ at, stale, onboard }: { at: { x: number; y: number }; stale: boolean; onboard: boolean }) {
  const ink = stale ? 'var(--outline)' : 'var(--primary)';
  const glyphInk = stale ? ink : 'var(--on-primary)';
  return (
    <g>
      {!stale && <circle cx={at.x} cy={at.y} r={26} fill={ink} fillOpacity={0.16} />}
      <circle cx={at.x} cy={at.y} r={17} fill={stale ? 'transparent' : ink} stroke={ink} strokeWidth={stale ? 2.5 : 1} />
      <g transform={`translate(${at.x - 9} ${at.y - 9})`} fill="none" stroke={glyphInk} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {onboard ? (
          // A seated passenger.
          <path d="M6 2.5 a1.5 1.5 0 1 0 0.01 0 M6 6 V11 H12 L14 16 M4 8 V13 H10" />
        ) : (
          // A car.
          <path d="M3 11 L4.5 6 H13.5 L15 11 V14 H3 Z M5.5 14 V15.5 M12.5 14 V15.5 M3 11 H15" />
        )}
      </g>
    </g>
  );
}
