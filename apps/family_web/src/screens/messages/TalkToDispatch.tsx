import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useFeedback } from '../../components/feedback';
import { AppCard, Button, SectionHeader } from '../../components/ui';
import { useMessagingStore } from '../../messaging/react';
import { CallBar } from './ChatThread';

/**
 * Message or call the dispatch desk carrying this ride. The thread is the
 * ride's own, so dispatch sees at once which trip and which patient it is about.
 */
export function TalkToDispatch({ rideId }: { rideId: string }) {
  const store = useMessagingStore();
  const navigate = useNavigate();
  const { showFailure } = useFeedback();
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    try {
      const conversation = await store.open({ kind: 'dispatchFamily', rideId });
      navigate(`/messages/${conversation.id}`);
    } catch (error) {
      showFailure(error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="mt-lg">
      <SectionHeader
        title="Talk to dispatch"
        subtitle="About this ride — a late pickup, a gate code, a change of plan."
      />
      <AppCard>
        <Button
          icon={MessageSquare}
          block
          disabled={opening}
          onClick={() => void open()}
        >
          Message dispatch
        </Button>
        <div className="mt-md">
          <CallBar context={{ rideId }} compact />
        </div>
      </AppCard>
    </div>
  );
}
