import { useEffect, useState } from 'react';

import { useFeedback } from '../../components/feedback';
import { AppCard, Button, Page, SwitchRow, TextField } from '../../components/ui';
import { backgroundPushNote, useBackgroundPush, useMessagingStore } from '../../messaging/react';

/**
 * The number your phone rings on when you call dispatch or the driver through
 * CareBridge, and whether this browser makes a sound or shows a notification
 * when a message arrives.
 */
export function CallSettingsScreen() {
  const store = useMessagingStore();
  const { attention } = store;
  const { showConfirmation, showFailure } = useFeedback();
  const [phone, setPhone] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sound, setSound] = useState(attention.soundOn);
  const [notify, setNotify] = useState(attention.notificationsAllowed);
  const background = useBackgroundPush('family');

  useEffect(() => {
    void store.client
      .myNumber()
      .then((n) => setPhone(n ?? ''))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [store]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await store.client.setMyNumber(phone);
      setPhone(saved ?? '');
      showConfirmation(saved ? 'Saved.' : 'Number removed.');
    } catch (error) {
      showFailure(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Calls and messages" back narrow>
      <AppCard>
        <TextField
          label="Your phone number"
          helper="When you call through CareBridge, this phone rings first. Dispatch and drivers never see it — they see the CareBridge number."
          type="tel"
          autoComplete="tel"
          value={phone}
          disabled={!loaded}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button className="mt-md" disabled={!loaded || saving} onClick={() => void save()}>
          Save number
        </Button>
      </AppCard>
      <AppCard className="mt-md" flush>
        <div className="tile dense">
          <SwitchRow
            title="Play a sound for new messages"
            checked={sound}
            onChange={(on) => {
              attention.setSound(on);
              setSound(on);
            }}
          />
        </div>
        <div className="tile dense">
          <SwitchRow
            title="Notify me when CareBridge is closed"
            subtitle={backgroundPushNote(background.status)}
            checked={background.status === 'on'}
            disabled={background.busy || (background.status !== 'on' && background.status !== 'off')}
            onChange={(on) => void background.toggle(on)}
          />
        </div>
        {attention.notificationsSupported && (
          <div className="tile dense">
            <SwitchRow
              title="Notify me when this page is in the background"
              subtitle="Notifications say a message arrived, never who sent it or what it says."
              checked={notify}
              disabled={notify}
              onChange={() => void attention.requestNotifications().then(setNotify)}
            />
          </div>
        )}
      </AppCard>
    </Page>
  );
}
