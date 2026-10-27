import { useEffect, useState } from 'react';

import { Modal, useFeedback } from '../../components/feedback';
import { Button, Switch, TextField } from '../../components/ui';
import { useRun } from '../../components/useRun';
import {
  backgroundPushNote,
  useBackgroundPush,
  useMessagingStore,
} from '../../messaging/react';

/**
 * The number your own phone rings on when you place a relay call, and how
 * this tab gets your attention. The number is only ever shown to you; the
 * people you call see the relay number.
 */
export function CallSettingsSheet({ onClose }: { onClose: () => void }) {
  const store = useMessagingStore();
  const { attention } = store;
  const { showConfirmation } = useFeedback();
  const { run, busy } = useRun();
  const [phone, setPhone] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sound, setSound] = useState(attention.soundOn);
  const [notify, setNotify] = useState(attention.notificationsAllowed);
  const background = useBackgroundPush('ops');

  useEffect(() => {
    void store.client
      .myNumber()
      .then((n) => setPhone(n ?? ''))
      .finally(() => setLoaded(true));
  }, [store]);

  const save = async () => {
    const result = await run(() => store.client.setMyNumber(phone));
    if (result.ok) {
      setPhone(result.value ?? '');
      showConfirmation(
        result.value
          ? 'Saved. Calls you place will ring this number first.'
          : 'Number removed.',
      );
    }
  };

  return (
    <Modal title="Calls and alerts" onClose={onClose}>
      <TextField
        label="Your phone number"
        helper="When you call someone, this phone rings first; answer it to be connected. Leave empty to use the company line."
        type="tel"
        autoComplete="tel"
        value={phone}
        disabled={!loaded}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Switch
        label="Play a sound for new messages and calls"
        checked={sound}
        onChange={(on) => {
          attention.setSound(on);
          setSound(on);
        }}
      />
      {attention.notificationsSupported && (
        <Switch
          label="Desktop notifications when this tab is in the background"
          description="They say that something arrived, never who or what."
          checked={notify}
          disabled={notify}
          onChange={() => void attention.requestNotifications().then(setNotify)}
        />
      )}
      <Switch
        label="Notifications when the console is closed"
        description={backgroundPushNote(background.status)}
        checked={background.status === 'on'}
        disabled={
          background.busy || (background.status !== 'on' && background.status !== 'off')
        }
        onChange={(on) => void background.toggle(on)}
      />
      <div className="dialog-actions">
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
        <Button busy={busy} disabled={!loaded} onClick={() => void save()}>
          Save number
        </Button>
      </div>
    </Modal>
  );
}
