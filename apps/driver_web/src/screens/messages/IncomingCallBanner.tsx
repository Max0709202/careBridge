import { PhoneIncoming, X } from 'lucide-react';

import { IconButton } from '../../components/ui';
import { useMessagingState, useMessagingStore } from '../../messaging/react';

/** Your phone is ringing with a CareBridge call: this says who it really is. */
export function IncomingCallBanner() {
  const store = useMessagingStore();
  const { incoming } = useMessagingState();
  if (!incoming) return null;

  return (
    <div className="incoming-call" role="alert">
      <PhoneIncoming size={22} aria-hidden />
      <span className="grow">
        <span className="bold">{incoming.fromLabel}</span> is calling your phone now.
      </span>
      <IconButton icon={X} label="Dismiss" onClick={() => store.dismissIncoming()} />
    </div>
  );
}
