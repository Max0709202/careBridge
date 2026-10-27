import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Coordinates } from '../../domain/models';

/**
 * The trip on a street map: pickup, clinic, the car, and the road it is
 * following. Replaces the schematic diagram (route_map.dart's port) at the
 * client's request, so a family can see where the car actually is.
 *
 * The honesty rules the diagram kept still hold here:
 *
 *  - **The road is drawn only when the routing provider gave one.** Without
 *    it the car is joined to its next stop by a dotted guide line, styled so
 *    it cannot be mistaken for a route.
 *  - **A stale position hollows the marker out**, and a lost one is not drawn
 *    at all — the screen around the map says so in words.
 *
 * The only file in the family app that knows which map library is underneath.
 * Default export so the screen can load it lazily: the map library is most of
 * its weight and only this screen needs it.
 */
export interface StreetMapProps {
  pickup: Coordinates;
  destination: Coordinates;
  /** Null when there is no position worth showing (none yet, or lost). */
  driver: Coordinates | null;
  isStale: boolean;
  passengerOnboard: boolean;
  /** The road to the stop ahead, or null to draw a guide line instead. */
  route: Coordinates[] | null;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const latLng = (c: Coordinates): L.LatLngTuple => [c.latitude, c.longitude];

export default function StreetMap(props: StreetMapProps) {
  const element = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  // Set while the map is being moved by us, so a user's own pan or zoom can be
  // told apart from ours.
  const fitting = useRef(false);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (!element.current) return;
    const created = L.map(element.current, { zoomControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(created);
    layer.current = L.layerGroup().addTo(created);
    // The family took the map somewhere else: stop dragging it back to the car.
    created.on('movestart', () => {
      if (!fitting.current) setFollowing(false);
    });
    map.current = created;
    return () => {
      created.remove();
      map.current = null;
    };
  }, []);

  const ahead = props.passengerOnboard ? props.destination : props.pickup;

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();

    if (props.driver && props.route) {
      L.polyline(props.route.map(latLng), {
        className: 'street-route',
        interactive: false,
      }).addTo(group);
    } else if (props.driver) {
      L.polyline([latLng(props.driver), latLng(ahead)], {
        className: 'street-guide',
        interactive: false,
      }).addTo(group);
    }

    stop(props.pickup, 'street-stop street-stop-pickup', 'Pickup').addTo(group);
    stop(props.destination, 'street-stop street-stop-clinic', 'Clinic').addTo(group);

    if (props.driver) {
      L.circleMarker(latLng(props.driver), {
        radius: 11,
        className: props.isStale ? 'street-car street-car-stale' : 'street-car',
        interactive: false,
      }).addTo(group);
    }
  }, [
    props.pickup,
    props.destination,
    props.driver,
    props.isStale,
    props.route,
    ahead,
  ]);

  // Keep the car and the stop it is heading for in view while following.
  useEffect(() => {
    const current = map.current;
    if (!current || !following) return;
    const points = props.driver
      ? [props.driver, ahead, ...(props.route ?? [])]
      : [props.pickup, props.destination];
    fitting.current = true;
    current.fitBounds(L.latLngBounds(points.map(latLng)), {
      padding: [36, 36],
      maxZoom: 16,
      animate: false,
    });
    fitting.current = false;
  }, [following, props.driver, props.route, props.pickup, props.destination, ahead]);

  const label = props.driver
    ? `Street map showing the car, the pickup and the clinic.${props.isStale ? ' The car’s position may be out of date.' : ''}`
    : 'Street map showing the pickup and the clinic. The car’s position is not available.';

  return (
    <div className="street-map" role="region" aria-label={label}>
      <div ref={element} className="street-map-canvas" />
      {!following && (
        <button
          type="button"
          className="street-recentre"
          onClick={() => setFollowing(true)}
        >
          <LocateFixed size={18} aria-hidden />
          Re-centre
        </button>
      )}
    </div>
  );
}

function stop(point: Coordinates, className: string, label: string): L.CircleMarker {
  return L.circleMarker(latLng(point), {
    radius: 9,
    className,
    interactive: false,
  }).bindTooltip(label, {
    permanent: true,
    direction: 'top',
    offset: [0, -8],
    className: 'street-label',
  });
}
