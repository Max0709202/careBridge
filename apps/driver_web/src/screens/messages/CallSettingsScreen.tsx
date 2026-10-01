import { useEffect, useState } from 'react';

import { useFeedback } from '../../components/feedback';
import { Button, InfoCard, Page, TextField } from '../../components/ui';
import { backgroundPushNote, useBackgroundPush, useMessagingStore } from '../../messaging/react';

/**
 * The number this phone rings on for relay calls, and how this page gets your
 * attention. Passengers, families and dispatch see the CareBridge number,
 * never this one.
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
  const background = useBackgroundPush('driver');

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
    <Page title="Calls and alerts" back="/messages">
      <div className="stack gap-md">
        <InfoCard label="Your phone number">
          <TextField
            label="Your phone number"
            helper="When you call dispatch or a passenger through CareBridge, this phone rings first. Nobody sees this number."
            type="tel"
            autoComplete="tel"
            value={phone}
            disabled={!loaded}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button variant="outlined" className="mt-md" busy={saving} disabled={!loaded} onClick={() => void save()}>
            Save number
          </Button>
        </InfoCard>
        <InfoCard label="Alerts">
          <label className="check-line">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                attention.setSound(e.target.checked);
                setSound(e.target.checked);
              }}
            />
            Play a sound for new messages and calls
          </label>
          <label className="check-line mt-sm">
            <input
              type="checkbox"
              checked={background.status === 'on'}
              disabled={background.busy || (background.status !== 'on' && background.status !== 'off')}
              onChange={(e) => void background.toggle(e.target.checked)}
            />
            <span>
              Notify me when CareBridge is closed
              <span className="muted" style={{ display: 'block' }}>
                {backgroundPushNote(background.status)}
              </span>
            </span>
          </label>
          {attention.notificationsSupported && (
            <label className="check-line mt-sm">
              <input
                type="checkbox"
                checked={notify}
                disabled={notify}
                onChange={() => void attention.requestNotifications().then(setNotify)}
              />
              Notify me when this page is in the background — never who sent it or what it says
            </label>
          )}
        </InfoCard>
      </div>
    </Page>
  );
}
