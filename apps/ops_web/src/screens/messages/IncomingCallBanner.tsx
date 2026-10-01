import { PhoneIncoming, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, IconButton } from '../../components/ui';
import { useMessagingState, useMessagingStore } from '../../messaging/react';

/**
 * Your phone is ringing with a CareBridge call. The caller ID shows the relay
 * number, which means nothing to anybody — this says who it actually is.
 */
export function IncomingCallBanner() {
  const store = useMessagingStore();
  const { incoming } = useMessagingState();
  const navigate = useNavigate();
  if (!incoming) return null;

  return (
    <div className="incoming-call" role="alert">
      <PhoneIncoming size={20} aria-hidden />
      <span className="grow">
        <span className="bold">{incoming.fromLabel}</span> is calling your phone now.
      </span>
      {incoming.conversationId && (
        <Button
          variant="text"
          onClick={() => {
            navigate(`/messages/${incoming.conversationId}`);
            store.dismissIncoming();
          }}
        >
          Open conversation
        </Button>
      )}
      <IconButton icon={X} label="Dismiss" onClick={() => store.dismissIncoming()} />
    </div>
  );
}
