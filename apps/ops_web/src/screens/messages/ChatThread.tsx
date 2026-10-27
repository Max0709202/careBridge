import { AlertCircle, Car, Clock, Phone, PhoneOff, RotateCw, Send } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, cx, Spinner } from '../../components/ui';
import { useRun } from '../../components/useRun';
import { formatClock, formatDay } from '../../core/format';
import {
  callStatusLabel,
  isLiveCall,
  kindLabel,
  MESSAGE_MAX_LENGTH,
  sameDay,
  type CallContext,
  type CallTarget,
  type ChatMessage,
  type Conversation,
} from '../../messaging/model';
import { useCallFor, useMessagingStore, useThread } from '../../messaging/react';

/**
 * One conversation: who it is with, which trip it is about, the messages, and
 * a way to ring the other side through the relay.
 */
export function ChatThread({ conversation }: { conversation: Conversation }) {
  const thread = useThread(conversation.id);
  const store = useMessagingStore();
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = thread?.messages[thread.messages.length - 1]?.id;

  // Follow the conversation as it grows, the way a chat is read.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId]);

  return (
    <section className="chat" aria-label={`Conversation: ${conversation.title}`}>
      <header className="chat-header">
        <div className="grow">
          <div className="t-title">{conversation.title}</div>
          <div className="t-small muted">{kindLabel(conversation.kind)}</div>
        </div>
      </header>
      {conversation.ride && (
        // The trip this thread is about, always visible, so nobody has to
        // infer from the messages which patient or which pickup is meant.
        <div className="chat-ride" role="note">
          <Car size={16} aria-hidden />
          <span className="bold">{conversation.ride.patientName}</span>
          <span>
            · pickup {formatDay(conversation.ride.scheduledPickupAt)},{' '}
            {formatClock(conversation.ride.scheduledPickupAt)}
          </span>
          <span className="pill tone-later">
            {rideStatusLabel(conversation.ride.status)}
          </span>
        </div>
      )}
      <CallBar context={{ conversationId: conversation.id }} />
      <ol className="chat-messages" ref={listRef} aria-live="polite">
        {thread?.hasMore && (
          <li className="chat-older">
            <Button
              variant="text"
              busy={thread.loading}
              onClick={() => void store.loadOlder(conversation.id)}
            >
              Earlier messages
            </Button>
          </li>
        )}
        {!thread || (thread.loading && thread.messages.length === 0) ? (
          <li className="chat-empty">
            <Spinner />
          </li>
        ) : thread.messages.length === 0 ? (
          <li className="chat-empty muted">No messages yet. Say hello.</li>
        ) : (
          thread.messages.map((message, index) => (
            <MessageItem
              key={message.clientMessageId + message.id}
              message={message}
              previous={thread.messages[index - 1]}
              onRetry={() => void store.retry(conversation.id, message.clientMessageId)}
            />
          ))
        )}
      </ol>
      {conversation.canPost ? (
        <Composer conversationId={conversation.id} />
      ) : (
        <p className="chat-closed t-small muted">
          {conversation.kind === 'driverDriver'
            ? 'You can read this conversation between drivers, but not write in it.'
            : 'This trip has finished, so the conversation is closed.'}
        </p>
      )}
    </section>
  );
}

function MessageItem(props: {
  message: ChatMessage;
  previous: ChatMessage | undefined;
  onRetry: () => void;
}) {
  const { message, previous } = props;
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const sameSender =
    !newDay &&
    previous &&
    previous.senderLabel === message.senderLabel &&
    previous.mine === message.mine;

  return (
    <>
      {newDay && (
        <li className="chat-day" aria-hidden>
          {formatDay(message.createdAt)}
        </li>
      )}
      {message.senderRole === 'system' ? (
        <li className="chat-system">
          {message.body} · {formatClock(message.createdAt)}
        </li>
      ) : (
        <li
          className={cx(
            'chat-message',
            message.mine && 'mine',
            message.delivery !== 'sent' && message.delivery,
          )}
        >
          {!sameSender && !message.mine && (
            <div className="chat-sender">{message.senderLabel}</div>
          )}
          <div className="chat-bubble">{message.body}</div>
          <div className="chat-meta">
            {message.delivery === 'pending' && (
              <>
                <Clock size={12} aria-hidden /> Sending…
              </>
            )}
            {message.delivery === 'failed' && (
              <button type="button" className="chat-retry" onClick={props.onRetry}>
                <AlertCircle size={12} aria-hidden /> Not sent — retry{' '}
                <RotateCw size={12} aria-hidden />
              </button>
            )}
            {message.delivery === 'sent' && formatClock(message.createdAt)}
          </div>
        </li>
      )}
    </>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const store = useMessagingStore();
  const [text, setText] = useState('');
  const trimmed = text.trim();

  const send = () => {
    if (!trimmed) return;
    void store.send(conversationId, trimmed);
    setText('');
  };

  // Enter sends, Shift+Enter is a new line — what every chat does.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Message"
        placeholder="Write a message"
        value={text}
        maxLength={MESSAGE_MAX_LENGTH}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" icon={Send} disabled={!trimmed} aria-label="Send">
        Send
      </Button>
    </form>
  );
}

/**
 * Who can be rung from here, and the call in progress. The server decides who
 * is callable and never sends a number; a target that cannot be rung says why.
 */
export function CallBar({ context }: { context: CallContext }) {
  const store = useMessagingStore();
  const call = useCallFor(context);
  const [targets, setTargets] = useState<CallTarget[] | null>(null);
  const { run, busy } = useRun();
  const key = 'conversationId' in context ? context.conversationId : context.rideId;

  useEffect(() => {
    let live = true;
    store.client
      .callTargets(context)
      .then((list) => live && setTargets(list))
      .catch(() => live && setTargets([]));
    return () => {
      live = false;
    };
    // `context` is rebuilt every render; its id is what matters.
  }, [store, key]);

  if (call && isLiveCall(call)) {
    return (
      <div className="call-bar live" role="status">
        <Phone size={16} aria-hidden />
        <span className="grow">{callStatusLabel(call)}</span>
      </div>
    );
  }

  if (!targets || targets.length === 0) {
    return call ? (
      <div className="call-bar" role="status">
        <PhoneOff size={16} aria-hidden />
        <span className="grow t-small">{callStatusLabel(call)}</span>
      </div>
    ) : null;
  }

  return (
    <div className="call-bar">
      {call && <span className="t-small muted">{callStatusLabel(call)}</span>}
      {targets.map((target) => (
        <Button
          key={`${target.kind}:${target.id}`}
          variant="outlined"
          icon={Phone}
          disabled={!target.available || busy}
          title={
            target.unavailableReason ??
            `Call ${target.label} through the CareBridge relay`
          }
          onClick={() =>
            void run(() => store.call(context, { kind: target.kind, id: target.id }))
          }
        >
          Call {target.label}
        </Button>
      ))}
      {targets.some((t) => !t.available) && (
        <span className="t-small muted">
          {targets.find((t) => !t.available)?.unavailableReason}
        </span>
      )}
    </div>
  );
}

function rideStatusLabel(status: string): string {
  const words = status.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
