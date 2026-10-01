import { Headset } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, InfoCard } from '../../components/ui';
import { useRun } from '../../components/useRun';
import { useMessagingStore } from '../../messaging/react';
import { CallBar } from './ChatThread';

/**
 * Dispatch, about this trip: a thread that already says which passenger, and
 * relay calls — to dispatch, and to the passenger while the trip is under way.
 */
export function JobContact({ rideId }: { rideId: string }) {
  const store = useMessagingStore();
  const navigate = useNavigate();
  const { run, busy } = useRun();

  const open = async () => {
    const result = await run(() => store.open({ kind: 'dispatchDriver', rideId }));
    if (result.ok) navigate(`/messages/${result.value.id}`);
  };

  return (
    <InfoCard label="Dispatch">
      <p className="t-label">Dispatch</p>
      <Button variant="outlined" icon={Headset} className="mt-sm" busy={busy} onClick={() => void open()}>
        Message dispatch about this trip
      </Button>
      <div className="mt-sm">
        <CallBar context={{ rideId }} compact />
      </div>
    </InfoCard>
  );
}
