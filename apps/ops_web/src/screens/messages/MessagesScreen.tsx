import { ArrowLeft, MessageSquare, MessageSquarePlus, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Button,
  cx,
  EmptyState,
  IconButton,
  LoadFailure,
  LoadingBlock,
  Screen,
  StaleBanner,
} from '../../components/ui';
import { formatClock, formatDay } from '../../core/format';
import {
  sameDay,
  type Conversation,
  type ConversationKind,
} from '../../messaging/model';
import { useInbox, useMessagingStore } from '../../messaging/react';
import { useOperatorId } from '../../state/context';
import { ChatThread } from './ChatThread';
import { CallSettingsSheet } from './CallSettingsSheet';
import { NewConversationSheet } from './NewConversationSheet';

type Filter = 'all' | 'unread' | 'families' | 'drivers' | 'driverDriver';

const FILTERS: Array<{ id: Filter; label: string; kinds?: ConversationKind[] }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'families', label: 'Families', kinds: ['dispatchFamily'] },
  { id: 'drivers', label: 'Drivers', kinds: ['dispatchDriver', 'operatorDrivers'] },
  { id: 'driverDriver', label: 'Driver to driver', kinds: ['driverDriver'] },
];

/**
 * Every conversation this operator's desk is part of, and the one being read.
 *
 * Side by side on a wide screen; on a narrow one the thread replaces the list,
 * with a way back. Scoped to the operator in the title bar — a dispatcher
 * working for two companies sees each company's conversations under its name.
 */
export function MessagesScreen() {
  const organizationId = useOperatorId();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const store = useMessagingStore();
  const { inbox, error } = useInbox();
  const [filter, setFilter] = useState<Filter>('all');
  const [composing, setComposing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [opened, setOpened] = useState<Conversation | null>(null);

  const mine = useMemo(
    () => (inbox ?? []).filter((c) => c.organizationId === organizationId),
    [inbox, organizationId],
  );
  const shown = useMemo(() => {
    const rule = FILTERS.find((f) => f.id === filter)!;
    return mine.filter((c) =>
      filter === 'unread'
        ? c.unreadCount > 0
        : !rule.kinds || rule.kinds.includes(c.kind),
    );
  }, [mine, filter]);

  const selected = conversationId
    ? (mine.find((c) => c.id === conversationId) ?? opened)
    : null;

  // A thread opened from a link or a notification that the list does not
  // have — asked for once the list has loaded, so it is not asked for twice.
  useEffect(() => {
    if (!conversationId || !inbox || mine.some((c) => c.id === conversationId)) return;
    let live = true;
    store
      .ensureConversation(conversationId)
      .then((c) => live && setOpened(c))
      .catch(() => live && setOpened(null));
    return () => {
      live = false;
    };
  }, [store, conversationId, inbox, mine]);

  return (
    <Screen
      title="Messages"
      wide
      actions={
        <>
          <IconButton
            icon={Settings2}
            label="Calls and alerts"
            onClick={() => setSettings(true)}
          />
          <Button
            variant="tonal"
            icon={MessageSquarePlus}
            onClick={() => setComposing(true)}
          >
            New
          </Button>
        </>
      }
    >
      <div className={cx('messages', selected && 'has-thread')}>
        <div className="inbox">
          <div className="chip-row" role="tablist" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={cx('chip', filter === f.id && 'selected')}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {inbox && error ? (
            <StaleBanner error={error} onRetry={() => void store.loadInbox()} />
          ) : null}
          {!inbox && error ? (
            <LoadFailure
              title="Could not load messages"
              onRetry={() => void store.loadInbox()}
            />
          ) : !inbox ? (
            <LoadingBlock />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={filter === 'unread' ? 'All caught up' : 'No conversations yet'}
              message="Message a family from the queue, or a driver from the roster or with New."
            />
          ) : (
            <ul className="list inbox-list">
              {shown.map((c) => (
                <li key={c.id}>
                  <InboxRow
                    conversation={c}
                    selected={c.id === conversationId}
                    onOpen={() => navigate(`/messages/${c.id}`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="thread-pane">
          {selected ? (
            <>
              <Button
                variant="text"
                icon={ArrowLeft}
                className="thread-back"
                onClick={() => navigate('/messages')}
              >
                All conversations
              </Button>
              <ChatThread key={selected.id} conversation={selected} />
            </>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Pick a conversation"
              message="Its messages and call controls show here."
            />
          )}
        </div>
      </div>
      {composing && (
        <NewConversationSheet
          organizationId={organizationId}
          onClose={(opened) => {
            setComposing(false);
            if (opened) navigate(`/messages/${opened.id}`);
          }}
        />
      )}
      {settings && <CallSettingsSheet onClose={() => setSettings(false)} />}
    </Screen>
  );
}

function InboxRow(props: {
  conversation: Conversation;
  selected: boolean;
  onOpen: () => void;
}) {
  const { conversation: c } = props;
  const at = c.lastMessageAt;
  const unread = c.unreadCount > 0;
  return (
    <button
      type="button"
      className={cx('inbox-row', props.selected && 'selected', unread && 'unread')}
      aria-current={props.selected || undefined}
      aria-label={`${unread ? `${c.unreadCount} unread. ` : ''}${c.title}`}
      onClick={props.onOpen}
    >
      <span className="row">
        <span className="grow t-body-lg inbox-title">{c.title}</span>
        {at && (
          <span className="t-small muted">
            {sameDay(at, new Date()) ? formatClock(at) : formatDay(at)}
          </span>
        )}
      </span>
      {c.ride && (
        <span className="t-small ink-primary">
          Trip · {c.ride.patientName} · {formatClock(c.ride.scheduledPickupAt)}
        </span>
      )}
      <span className="row">
        <span className="grow t-small muted inbox-preview">
          {c.lastMessage
            ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.body}`
            : 'No messages yet'}
        </span>
        {unread && <span className="badge">{c.unreadCount}</span>}
      </span>
    </button>
  );
}
