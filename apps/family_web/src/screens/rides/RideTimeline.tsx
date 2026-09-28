import { Circle, CircleAlert, CircleDot } from 'lucide-react';

import { AppCard } from '../../components/ui';
import { formatShortDay, formatTime } from '../../core/formatting';
import type { RideEvent } from '../../domain/models';

/**
 * The ride's event history — the artefact that settles disputes ("the driver
 * never came"), so it is shown to the family in full. Exceptions are marked
 * with an icon and a colour, never colour alone. Port of ride_timeline.dart.
 */
export function RideTimeline({ events }: { events: RideEvent[] }) {
  if (events.length === 0) {
    return (
      <AppCard>
        <p className="t-body muted">
          Nothing has happened yet. Updates appear here as the trip proceeds.
        </p>
      </AppCard>
    );
  }

  const ordered = [...events].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <AppCard>
      <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ordered.map((event, i) => {
          const first = i === 0;
          const last = i === ordered.length - 1;
          const Icon = event.isException ? CircleAlert : first ? CircleDot : Circle;
          const ink = event.isException ? 'ink-critical' : first ? 'ink-primary' : 'muted';
          return (
            <li key={`${event.at.toISOString()}-${i}`} className="timeline-row">
              <div className="timeline-rail">
                <Icon size={18} className={ink} aria-hidden />
                {!last && <span className="rail" />}
              </div>
              <div className="timeline-body">
                <p
                  className={`t-body-lg ${event.isException ? 'ink-critical' : ''}`}
                  style={{ fontWeight: first ? 700 : 500 }}
                >
                  {event.title}
                </p>
                <p className="t-small muted">
                  {formatShortDay(event.at)} · {formatTime(event.at)}
                </p>
                {event.detail && <p className="t-body mt-xs">{event.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </AppCard>
  );
}
