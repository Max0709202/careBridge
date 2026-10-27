import { Users } from 'lucide-react';

import { Modal } from '../../components/feedback';
import { Button, LoadingBlock } from '../../components/ui';
import { useRun } from '../../components/useRun';
import type { Conversation } from '../../messaging/model';
import { useMessagingStore } from '../../messaging/react';
import { useResource } from '../../state/context';
import { keys } from '../../state/opsStore';

/**
 * Start a thread with one driver, or post to the whole team. A family thread
 * starts from the queue, where the trip it is about is already in view.
 */
export function NewConversationSheet(props: {
  organizationId: string;
  onClose: (opened: Conversation | null) => void;
}) {
  const store = useMessagingStore();
  const drivers = useResource(keys.drivers(props.organizationId), (api) =>
    api.drivers(props.organizationId),
  );
  const { run, busy } = useRun();
  const working = (drivers.value ?? []).filter((d) => d.status === 'approved');

  const open = async (subject: Parameters<typeof store.open>[0]) => {
    const result = await run(() => store.open(subject));
    if (result.ok) props.onClose(result.value);
  };

  return (
    <Modal title="New conversation" sheet onClose={() => props.onClose(null)}>
      <Button
        variant="tonal"
        icon={Users}
        disabled={busy}
        onClick={() =>
          void open({ kind: 'operatorDrivers', organizationId: props.organizationId })
        }
      >
        Message every driver
      </Button>
      <h3 className="t-label mt-md">A driver</h3>
      {!drivers.value ? (
        <LoadingBlock />
      ) : working.length === 0 ? (
        <p className="muted">No approved drivers on the roster.</p>
      ) : (
        <ul className="list">
          {working.map((driver) => (
            <li key={driver.id}>
              <Button
                variant="text"
                disabled={busy}
                onClick={() =>
                  void open({
                    kind: 'dispatchDriver',
                    organizationId: props.organizationId,
                    driverId: driver.id,
                  })
                }
              >
                {driver.displayName}
                {driver.onShift ? ' · on shift' : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
