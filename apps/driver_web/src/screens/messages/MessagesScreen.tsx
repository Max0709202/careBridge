import { Headset, MessageSquare, Settings2, UserRound, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Modal } from '../../components/feedback';
import {
  Button,
  Centered,
  EmptyState,
  IconButton,
  Page,
  Spinner,
} from '../../components/ui';
import { useRun } from '../../components/useRun';
import { formatDay, formatTime } from '../format';
import {
  sameDay,
  type Colleague,
  type Conversation,
  type OpenSubject,
} from '../../messaging/model';
import { useInbox, useMessagingStore } from '../../messaging/react';
import { useDriver } from '../../state/context';

/**
 * Dispatch, the team channel, and colleagues. Dispatch first: it is the thread
 * a driver at a kerb actually needs, and it should never be a scroll away.
 */
export function MessagesScreen() {
  const { inbox, error } = useInbox();
  const { profile } = useDriver();
  const store = useMessagingStore();
  const navigate = useNavigate();
  const { run, busy } = useRun();
  const [picking, setPicking] = useState(false);
  const organizationId = profile.value?.organizationId;

  const open = async (subject: OpenSubject) => {
    const result = await run(() => store.open(subject));
    if (result.ok) navigate(`/messages/${result.value.id}`);
  };

  return (
    <Page
      title="Messages"
      back="/today"
      actions={
        <IconButton
          icon={Settings2}
          label="Calls and alerts"
          onClick={() => navigate('/settings/calls')}
        />
      }
    >
      <div className="stack gap-md">
        <div className="message-shortcuts">
          <Button
            variant="outlined"
            icon={Headset}
            busy={busy}
            onClick={() => void open({ kind: 'dispatchDriver' })}
          >
            Dispatch
          </Button>
          <Button
            variant="outlined"
            icon={Users}
            disabled={busy || !organizationId}
            onClick={() =>
              organizationId && void open({ kind: 'operatorDrivers', organizationId })
            }
          >
            Team
          </Button>
          <Button
            variant="outlined"
            icon={UserRound}
            disabled={busy || !organizationId}
            onClick={() => setPicking(true)}
          >
            A colleague
          </Button>
        </div>
        {!inbox && error ? (
          <EmptyState
            icon={MessageSquare}
            title="Could not load messages"
            message="Check your signal and try again."
            action={
              <Button variant="outlined" onClick={() => void store.loadInbox()}>
                Try again
              </Button>
            }
          />
        ) : !inbox ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : inbox.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            message="Message dispatch or the team from here."
          />
        ) : (
          <ul className="list">
            {inbox.map((c) => (
              <li key={c.id}>
                <InboxRow
                  conversation={c}
                  onOpen={() => navigate(`/messages/${c.id}`)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {picking && organizationId && (
        <ColleaguePicker
          organizationId={organizationId}
          onClose={(colleague) => {
            setPicking(false);
            if (colleague)
              void open({ kind: 'driverDriver', peerDriverId: colleague.driverId });
          }}
        />
      )}
    </Page>
  );
}

function InboxRow({
  conversation: c,
  onOpen,
}: {
  conversation: Conversation;
  onOpen: () => void;
}) {
  const unread = c.unreadCount > 0;
  const at = c.lastMessageAt;
  return (
    <button
      type="button"
      className="card inbox-row"
      aria-label={`${unread ? `${c.unreadCount} unread. ` : ''}${c.title}`}
      onClick={onOpen}
    >
      <span className="row">
        <span className="grow t-title" style={{ fontWeight: unread ? 700 : 500 }}>
          {c.title}
        </span>
        {at && (
          <span className="muted">
            {sameDay(at, new Date()) ? formatTime(at) : formatDay(at)}
          </span>
        )}
      </span>
      {c.ride && <span className="ink-primary">Trip with {c.ride.patientName}</span>}
      <span className="row">
        <span className="grow muted inbox-preview">
          {c.lastMessage
            ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.body}`
            : 'No messages yet'}
        </span>
        {unread && <span className="count-badge">{c.unreadCount}</span>}
      </span>
    </button>
  );
}

/**
 * Drivers at the same company. Only someone on shift can be messaged for the
 * first time — the rule is the server's; this just says so before you try.
 */
function ColleaguePicker(props: {
  organizationId: string;
  onClose: (colleague: Colleague | null) => void;
}) {
  const store = useMessagingStore();
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);

  useEffect(() => {
    void store.client
      .colleagues(props.organizationId)
      .then(setColleagues)
      .catch(() => setColleagues([]));
  }, [store, props.organizationId]);

  return (
    <Modal title="Message a colleague" sheet onClose={() => props.onClose(null)}>
      {!colleagues ? (
        <Spinner />
      ) : colleagues.length === 0 ? (
        <p className="muted">Nobody else is on the roster yet.</p>
      ) : (
        <ul className="list">
          {colleagues.map((c) => (
            <li key={c.driverId}>
              <Button
                variant="text"
                disabled={!c.onShift}
                onClick={() => props.onClose(c)}
                aria-label={c.onShift ? c.displayName : `${c.displayName}, off shift`}
              >
                {c.displayName}
                <span className="muted">
                  {c.onShift ? ' · on shift' : ' · off shift'}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
