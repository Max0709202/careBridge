import { MessageSquareOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Centered, EmptyState, Page, Spinner } from '../../components/ui';
import type { Conversation } from '../../messaging/model';
import { useInbox, useMessagingStore } from '../../messaging/react';
import { ChatThread } from './ChatThread';

export function ConversationScreen() {
  const { conversationId = '' } = useParams();
  const store = useMessagingStore();
  const { inbox } = useInbox();
  const known = inbox?.find((c) => c.id === conversationId) ?? null;
  const [loaded, setLoaded] = useState<Conversation | null | undefined>(undefined);

  useEffect(() => {
    if (known || !inbox) return;
    let live = true;
    store
      .ensureConversation(conversationId)
      .then((c) => live && setLoaded(c))
      .catch(() => live && setLoaded(null));
    return () => {
      live = false;
    };
  }, [store, conversationId, known, inbox]);

  const conversation = known ?? loaded ?? null;

  return (
    <Page title={conversation?.title ?? 'Messages'} back="/messages">
      {conversation ? (
        <ChatThread conversation={conversation} />
      ) : loaded === null ? (
        <EmptyState
          icon={MessageSquareOff}
          title="This conversation is not available"
          message="It may have closed, or the trip may have been given to another driver."
        />
      ) : (
        <Centered>
          <Spinner />
        </Centered>
      )}
    </Page>
  );
}
