/**
 * Pieces shared by the dashboard, ride detail and tracking screens.
 */
import { Accessibility, TriangleAlert } from 'lucide-react';

import { Avatar, StatusPill } from '../../components/ui';
import { initialsOf, vehicleDescription, type Driver } from '../../domain/models';

export function DelayBanner({ reason }: { reason: string | null }) {
  return (
    <div className="banner bg-caution ink-caution">
      <TriangleAlert size={22} aria-hidden style={{ flex: '0 0 auto' }} />
      <p className="t-body" style={{ fontWeight: 600 }}>
        {reason === null ? 'This ride is running late.' : `Running late — ${reason}`}
      </p>
    </div>
  );
}

export function DriverRow({ driver }: { driver: Driver }) {
  return (
    <div className="row">
      <Avatar text={initialsOf(driver.displayName)} size="md" />
      <div className="grow">
        <p className="t-title">{driver.displayName}</p>
        <p className="t-body muted" style={{ marginTop: 2 }}>
          {vehicleDescription(driver.vehicle)} · {driver.vehicle.licensePlate}
        </p>
        {driver.vehicle.isWheelchairAccessible && (
          <div className="mt-xs">
            <StatusPill
              label="Wheelchair accessible"
              icon={Accessibility}
              ink="positive"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function PriceLine({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={`line${muted ? ' muted' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
