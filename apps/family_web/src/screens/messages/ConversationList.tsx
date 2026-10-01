import { ChevronRight, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { AppCard, SectionHeader } from '../../components/ui';
import { formatDay, formatTime } from '../../core/formatting';
import { sameDay } from '../../messaging/model';
import { useInbox } from '../../messaging/react';

/**
 * Conversations with dispatch, at the top of Updates. Nothing at all when
 * there are none — a family that has never written to dispatch does not need
 * an empty box telling them so.
 */
export function ConversationList() {
  const { inbox } = useInbox();
  const navigate = useNavigate();
  if (!inbox || inbox.length === 0) return null;

  return (
    <div className="mb-md">
      <SectionHeader title="Conversations with dispatch" />
      <AppCard flush>
        {inbox.map((c) => {
          const unread = c.unreadCount > 0;
          const at = c.lastMessageAt;
          return (
            <button
              key={c.id}
              type="button"
              className="tile conversation-tile"
              aria-label={`${unread ? `${c.unreadCount} unread. ` : ''}${c.title}${c.ride ? `, about ${c.ride.patientName}'s ride` : ''}`}
              onClick={() => navigate(`/messages/${c.id}`)}
            >
              <span className="icon-box bg-info ink-info">
                <MessageSquare size={22} aria-hidden />
              </span>
              <span className="grow stack">
                <span className="t-body-lg" style={{ fontWeight: unread ? 700 : 500 }}>
                  {c.title}
                </span>
                {c.ride && (
                  <span className="t-small muted">
                    {c.ride.patientName}'s ride · {formatDay(c.ride.scheduledPickupAt)}
                  </span>
                )}
                {c.lastMessage && (
                  <span className="t-small muted conversation-preview">
                    {c.lastMessage.mine ? 'You: ' : ''}
                    {c.lastMessage.body}
                  </span>
                )}
              </span>
              <span className="stack center">
                {at && <span className="t-small muted">{sameDay(at, new Date()) ? formatTime(at) : formatDay(at)}</span>}
                {unread && <span className="count-badge">{c.unreadCount}</span>}
              </span>
              <ChevronRight size={20} aria-hidden className="muted" />
            </button>
          );
        })}
      </AppCard>
    </div>
  );
}
