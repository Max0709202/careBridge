import { Bell, CloudOff, Inbox, Mail, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { NotificationPreference } from '../../api/careApi';
import { useFeedback } from '../../components/feedback';
import { AppCard, Button, EmptyState, IconButton, Page, SectionHeader, Spinner, SwitchRow } from '../../components/ui';
import type { NotificationKind } from '../../domain/models';
import { useApi } from '../../state/context';

const channelLabel: Record<NotificationPreference['channel'], string> = {
  inApp: 'In the app',
  email: 'Email',
  push: 'Push',
};

/** Plain language for each event — the wire names are for the API. */
const kindLabel: Record<NotificationKind, string> = {
  appointmentCreated: 'An appointment is added',
  appointmentReminder: 'An appointment is coming up',
  appointmentChanged: 'An appointment changes',
  appointmentCanceled: 'An appointment is cancelled',
  rideRequested: 'Transport is requested',
  driverAssigned: 'A driver is assigned',
  driverEnRoute: 'The driver sets off',
  driverArrivingSoon: 'The driver is arriving soon',
  driverArrived: 'The driver arrives',
  patientPickedUp: 'The passenger is picked up',
  patientArrived: 'The passenger arrives',
  rideDelayed: 'A ride is delayed',
  rideCompleted: 'A ride is finished',
  rideCanceled: 'A ride is cancelled',
  accessGranted: 'Someone joins the care circle',
};

/**
 * Per-event, per-channel settings. The whole matrix comes from the server — a
 * client-side copy of the defaults would drift, and the symptom would be a
 * switch that says "off" while the server keeps sending. In-app is a fixed
 * row, not a disabled switch: it is the record of what happened.
 */
export function NotificationPreferencesScreen() {
  const api = useApi();
  const { showFailure } = useFeedback();
  const [rows, setRows] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.notificationPreferences());
    } catch (e) {
      setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function set(row: NotificationPreference, enabled: boolean) {
    const key = `${row.kind}:${row.channel}`;
    setPending((p) => new Set(p).add(key));
    try {
      setRows(await api.setNotificationPreference(row.kind, row.channel, enabled));
    } catch (e) {
      showFailure(e);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  }

  let body;
  if (error !== null) {
    body = (
      <AppCard>
        <EmptyState
          icon={CloudOff}
          title="Could not load your settings"
          message="Check your connection and try again."
          action={<Button variant="outlined" onClick={load}>Retry</Button>}
        />
      </AppCard>
    );
  } else if (rows === null) {
    body = <Spinner />;
  } else {
    // Grouped by kind, in the order the server sent them.
    const byKind = new Map<NotificationKind, NotificationPreference[]>();
    for (const row of rows) {
      const list = byKind.get(row.kind) ?? [];
      list.push(row);
      byKind.set(row.kind, list);
    }

    body = (
      <div className="stack">
        <AppCard>
          <p className="t-body muted">
            Emails and push messages never say who the appointment is for, which clinic it is at, or
            when. They say something changed and ask you to open the app — a phone on a kitchen table
            is readable by whoever is in the room.
          </p>
        </AppCard>
        {[...byKind.entries()].map(([kind, channels]) => (
          <div key={kind} className="mt-md">
            <SectionHeader title={kindLabel[kind] ?? kind} />
            <AppCard flush>
              {channels.map((row) =>
                row.configurable ? (
                  <div key={row.channel} className="tile dense">
                    <SwitchRow
                      leading={row.channel === 'email' ? <Mail aria-hidden className="muted" /> : <Bell aria-hidden className="muted" />}
                      title={channelLabel[row.channel]}
                      checked={row.enabled}
                      disabled={pending.has(`${row.kind}:${row.channel}`)}
                      onChange={(value) => set(row, value)}
                    />
                  </div>
                ) : (
                  <div key={row.channel} className="tile dense">
                    <Inbox className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
                    <div className="grow">
                      <p className="tile-title">{channelLabel[row.channel]}</p>
                      <p className="t-small muted">Always on — this is your record of what happened</p>
                    </div>
                  </div>
                ),
              )}
            </AppCard>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Page title="Notifications" back actions={<IconButton icon={RefreshCw} label="Refresh" onClick={load} />}>
      {body}
    </Page>
  );
}
