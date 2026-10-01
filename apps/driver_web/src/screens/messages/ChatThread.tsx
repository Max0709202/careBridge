import { AlertCircle, CarFront, Clock, Phone, RotateCw, Send } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, Spinner } from '../../components/ui';
import { useFeedback } from '../../components/feedback';
import { formatDay, formatTime } from '../format';
import {
  callStatusLabel,
  isLiveCall,
  MESSAGE_MAX_LENGTH,
  sameDay,
  type CallContext,
  type CallTarget,
  type ChatMessage,
  type Conversation,
} from '../../messaging/model';
import { useCallFor, useMessagingStore, useThread } from '../../messaging/react';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * A conversation — with dispatch, the team, or a colleague. A port of the
 * console's thread, sized for a phone held in one hand at the kerb.
 */
export function ChatThread({ conversation }: { conversation: Conversation }) {
  const thread = useThread(conversation.id);
  const store = useMessagingStore();
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = thread?.messages[thread.messages.length - 1]?.id;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId]);

  return (
    <section className="chat" aria-label={`Conversation with ${conversation.title}`}>
      {conversation.ride && (
        <div className="chat-ride" role="note">
          <CarFront size={18} aria-hidden />
          <span>
            Trip with <span className="bold">{conversation.ride.patientName}</span>,{' '}
            {formatDay(conversation.ride.scheduledPickupAt)} at {formatTime(conversation.ride.scheduledPickupAt)}
          </span>
        </div>
      )}
      <CallBar context={{ conversationId: conversation.id }} />
      <ol className="chat-messages" ref={listRef} aria-live="polite">
        {thread?.hasMore && (
          <li className="chat-older">
            <Button variant="text" busy={thread.loading} onClick={() => void store.loadOlder(conversation.id)}>
              Earlier messages
            </Button>
          </li>
        )}
        {!thread || (thread.loading && thread.messages.length === 0) ? (
          <li className="chat-empty">
            <Spinner />
          </li>
        ) : thread.messages.length === 0 ? (
          <li className="chat-empty muted">No messages yet.</li>
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
        <p className="chat-closed muted">This trip has finished, so its conversation is closed.</p>
      )}
    </section>
  );
}

function MessageItem(props: { message: ChatMessage; previous: ChatMessage | undefined; onRetry: () => void }) {
  const { message, previous } = props;
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const sameSender = !newDay && previous?.senderLabel === message.senderLabel && previous.mine === message.mine;

  return (
    <>
      {newDay && (
        <li className="chat-day" aria-hidden>
          {formatDay(message.createdAt)}
        </li>
      )}
      {message.senderRole === 'system' ? (
        <li className="chat-system">
          {message.body} · {formatTime(message.createdAt)}
        </li>
      ) : (
        <li className={cx('chat-message', message.mine && 'mine', message.delivery !== 'sent' && message.delivery)}>
          {!sameSender && !message.mine && <div className="chat-sender">{message.senderLabel}</div>}
          <div className="chat-bubble">{message.body}</div>
          <div className="chat-meta">
            {message.delivery === 'pending' && (
              <>
                <Clock size={14} aria-hidden /> Sending…
              </>
            )}
            {message.delivery === 'failed' && (
              <button type="button" className="chat-retry" onClick={props.onRetry}>
                <AlertCircle size={14} aria-hidden /> Not sent — tap to try again <RotateCw size={14} aria-hidden />
              </button>
            )}
            {message.delivery === 'sent' && formatTime(message.createdAt)}
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
      <Button type="submit" variant="quiet" icon={Send} disabled={!trimmed} aria-label="Send">
        Send
      </Button>
    </form>
  );
}

/**
 * Calls through the CareBridge relay. Your own phone rings first, then the
 * other person's; neither of you sees the other's number.
 */
export function CallBar({ context, compact }: { context: CallContext; compact?: boolean }) {
  const store = useMessagingStore();
  const call = useCallFor(context);
  const { showFailure } = useFeedback();
  const [targets, setTargets] = useState<CallTarget[] | null>(null);
  const [busy, setBusy] = useState(false);
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

  const place = async (target: CallTarget) => {
    setBusy(true);
    try {
      await store.call(context, { kind: target.kind, id: target.id });
    } catch (error) {
      showFailure(error);
    } finally {
      setBusy(false);
    }
  };

  if (call && isLiveCall(call)) {
    return (
      <div className="call-bar live" role="status">
        <Phone size={18} aria-hidden />
        <span className="grow">{callStatusLabel(call)}</span>
      </div>
    );
  }
  if (!targets || targets.length === 0) return null;

  const unavailable = targets.find((t) => !t.available);
  return (
    <div className={cx('call-bar', compact && 'compact')}>
      {call && <p className="t-small muted">{callStatusLabel(call)}</p>}
      {targets.map((target) => (
        <Button
          key={`${target.kind}:${target.id}`}
          variant="outlined"
          icon={Phone}
          disabled={!target.available || busy}
          onClick={() => void place(target)}
        >
          Call {target.label}
        </Button>
      ))}
      <p className="t-small muted">
        {unavailable?.unavailableReason ?? 'Your phone rings first. Neither side sees the other’s number.'}
      </p>
    </div>
  );
}
