import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useRef } from 'react';

import {
  freshnessOf,
  MILES_TO_METERS,
  type Coordinates,
  type LiveRide,
  type ServiceArea,
} from '../domain/liveMap';

/**
 * The map itself — the only file that knows which map library is underneath.
 *
 * Leaflet over OpenStreetMap tiles today. Moving to Google Maps (or another
 * vendor) replaces this component and nothing above it: the screen hands it
 * plain coordinates and gets clicks back.
 *
 * Everything is drawn with vector shapes and CSS classes rather than image
 * markers, so colours follow the console's theme tokens (styles.css) and no
 * marker images need serving.
 */
export interface LiveMapProps {
  area: ServiceArea | null;
  rides: LiveRide[];
  now: Date;
  /** The ride whose pickup and destination are drawn, if any. */
  selectedRideId: string | null;
  onSelectRide?: (rideId: string) => void;
  /** Set while an admin is placing a radius: clicks on the map report a point. */
  onPickPoint?: (point: Coordinates) => void;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Where the map opens when there is nothing to fit to: the continental US. */
const FALLBACK_VIEW: { center: L.LatLngExpression; zoom: number } = {
  center: [39.5, -98.35],
  zoom: 4,
};

const latLng = (c: Coordinates): L.LatLngTuple => [c.latitude, c.longitude];

export function LiveMap(props: LiveMapProps) {
  const element = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const areaLayer = useRef<L.LayerGroup | null>(null);
  const rideLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const onPick = useRef(props.onPickPoint);
  onPick.current = props.onPickPoint;
  const onSelect = useRef(props.onSelectRide);
  onSelect.current = props.onSelectRide;

  // Created once. Leaflet owns this DOM node from here on.
  useEffect(() => {
    if (!element.current) return;
    const created = L.map(element.current, { zoomControl: true }).setView(
      FALLBACK_VIEW.center,
      FALLBACK_VIEW.zoom,
    );
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(created);
    areaLayer.current = L.layerGroup().addTo(created);
    rideLayer.current = L.layerGroup().addTo(created);
    created.on('click', (event: L.LeafletMouseEvent) => {
      onPick.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    map.current = created;
    // A new map has not been fitted, even if an earlier one was: StrictMode
    // mounts this twice in development, and refs outlive the first.
    fitted.current = false;
    return () => {
      created.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = areaLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!props.area) return;
    const options: L.PathOptions = { className: 'map-area', interactive: false };
    if (props.area.kind === 'radius') {
      L.circle(latLng(props.area.center), {
        ...options,
        radius: props.area.radiusMiles * MILES_TO_METERS,
      }).addTo(layer);
    } else {
      L.polygon(props.area.points.map(latLng), options).addTo(layer);
    }
  }, [props.area]);

  useEffect(() => {
    const layer = rideLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const ride of props.rides) {
      const selected = ride.rideId === props.selectedRideId;
      if (selected) {
        if (ride.pickup)
          stop(
            ride.pickup,
            'map-stop map-stop-pickup',
            `Pickup — ${ride.patientName}`,
          ).addTo(layer);
        if (ride.destination)
          stop(ride.destination, 'map-stop map-stop-destination', 'Destination').addTo(
            layer,
          );
        const heading =
          freshnessOf(ride.position, props.now) !== 'lost' ? ride.position : null;
        if (heading && ride.route) {
          // The road the arrival time was computed along. It starts where the
          // car was then, so the car is joined to it rather than assumed on it.
          L.polyline(ride.route.path.map(latLng), {
            className: 'map-route',
            interactive: false,
          }).addTo(layer);
        } else if (heading) {
          // No road from the routing provider: a straight guide line, styled
          // so it cannot be mistaken for one.
          const stopAhead = isOnboard(ride.status) ? ride.destination : ride.pickup;
          if (stopAhead) {
            L.polyline([latLng(heading), latLng(stopAhead)], {
              className: 'map-guide',
              interactive: false,
            }).addTo(layer);
          }
        }
      }

      const freshness = freshnessOf(ride.position, props.now);
      if (!ride.position || freshness === 'lost') continue;
      const marker = L.circleMarker(latLng(ride.position), {
        radius: selected ? 10 : 8,
        className: `map-car map-car-${freshness}${selected ? ' map-car-selected' : ''}`,
      });
      marker.bindTooltip(
        freshness === 'stale'
          ? `${ride.driverName} (position may be out of date)`
          : ride.driverName,
        { direction: 'top' },
      );
      marker.on('click', () => onSelect.current?.(ride.rideId));
      marker.addTo(layer);
    }
  }, [props.rides, props.selectedRideId, props.now]);

  // Fit once, to the first thing worth fitting to. Refitting on every update
  // would yank the view away from wherever the dispatcher had moved it.
  useEffect(() => {
    const current = map.current;
    if (!current || fitted.current) return;
    const points: L.LatLngTuple[] = [];
    if (props.area?.kind === 'radius') {
      const bounds = L.latLng(latLng(props.area.center)).toBounds(
        props.area.radiusMiles * MILES_TO_METERS * 2,
      );
      points.push(
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      );
    } else if (props.area?.kind === 'polygon') {
      points.push(...props.area.points.map(latLng));
    }
    for (const ride of props.rides)
      if (ride.position) points.push(latLng(ride.position));
    if (points.length === 0) return;
    fitted.current = true;
    current.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 14 });
  }, [props.area, props.rides]);

  // Two elements on purpose. Leaflet adds its own classes to the node it is
  // given, and React replaces the whole class list whenever `className`
  // changes — so the node React styles is never the one Leaflet owns.
  return (
    <div
      className={`live-map${props.onPickPoint ? ' picking' : ''}`}
      role="region"
      aria-label="Live map"
    >
      <div ref={element} className="live-map-canvas" />
    </div>
  );
}

/** The car has the passenger: the stop ahead is the destination. */
function isOnboard(status: string): boolean {
  return (
    status === 'passengerOnboard' ||
    status === 'inProgress' ||
    status === 'arrivedAtDestination'
  );
}

function stop(point: Coordinates, className: string, label: string): L.CircleMarker {
  return L.circleMarker(latLng(point), {
    radius: 7,
    className,
    interactive: true,
  }).bindTooltip(label, {
    direction: 'top',
  });
}
