import {
  MessageSquare,
  PhoneMissed,
  AlarmClock,
  Armchair,
  BellOff,
  Calendar,
  CalendarX2,
  CarFront,
  CircleCheckBig,
  CircleX,
  Clock,
  Hospital,
  Hourglass,
  MapPin,
  Timer,
  UserPlus,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useFeedback } from '../../components/feedback';
import { AppCard, Button, EmptyState, Page } from '../../components/ui';
import { formatFreshness } from '../../core/formatting';
import { notificationIsUrgent, type AppNotification, type NotificationKind } from '../../domain/models';
import { notificationsNewestFirst, unreadNotificationCount } from '../../state/careState';
import { useCare, useNow, useStore } from '../../state/context';
import { ConversationList } from '../messages/ConversationList';

const kindIcon: Record<NotificationKind, LucideIcon> = {
  appointmentCreated: Calendar,
  appointmentChanged: Calendar,
  appointmentReminder: AlarmClock,
  appointmentCanceled: CalendarX2,
  rideRequested: Hourglass,
  driverAssigned: UserRoundCheck,
  driverEnRoute: CarFront,
  driverArrivingSoon: Timer,
  driverArrived: MapPin,
  patientPickedUp: Armchair,
  patientArrived: Hospital,
  rideDelayed: Clock,
  rideCompleted: CircleCheckBig,
  rideCanceled: CircleX,
  accessGranted: UserPlus,
  messageReceived: MessageSquare,
  callMissed: PhoneMissed,
};

export function NotificationsScreen() {
  const state = useCare();
  const store = useStore();
  const now = useNow();
  const { showFailure } = useFeedback();
  const notifications = notificationsNewestFirst(state);

  return (
    <Page
      title="Updates"
      actions={
        unreadNotificationCount(state) > 0 && (
          <Button
            variant="text"
            onClick={async () => {
              try {
                await store.markAllNotificationsRead();
              } catch (error) {
                showFailure(error);
              }
            }}
          >
            Mark all read
          </Button>
        )
      }
    >
      <ConversationList />
      {notifications.length === 0 ? (
        <EmptyState
          fill
          icon={BellOff}
          title="Nothing to report"
          message="Updates about appointments and rides appear here, and as notifications on your phone."
        />
      ) : (
        <div className="stack gap-sm">
          <p className="t-small muted" style={{ marginBottom: 'var(--space-sm)' }}>
            Updates never include a name, a clinic, an address or a time — a phone on a kitchen table
            can be read by anyone in the room.
          </p>
          {notifications.map((n) => (
            <NotificationTile key={n.id} notification={n} now={now} />
          ))}
        </div>
      )}
    </Page>
  );
}

function NotificationTile({ notification, now }: { notification: AppNotification; now: Date }) {
  const store = useStore();
  const navigate = useNavigate();
  const unread = notification.readAt === null;
  const ink = notificationIsUrgent(notification.kind) ? 'caution' : 'info';
  const Icon = kindIcon[notification.kind];

  return (
    <AppCard
      border={unread ? 'primary' : undefined}
      ariaLabel={`${unread ? 'Unread. ' : ''}${notification.title}. ${notification.body}`}
      onClick={() => {
        // Navigation does not wait on the read receipt: opening the update is
        // what was asked for; marking it read is bookkeeping.
        void store.markNotificationRead(notification.id).catch(() => undefined);
        if (notification.conversationId) navigate(`/messages/${notification.conversationId}`);
        else if (notification.rideId) navigate(`/rides/${notification.rideId}`);
        else if (notification.appointmentId) navigate(`/appointments/${notification.appointmentId}`);
      }}
    >
      <div className="row start">
        <span className={`icon-box bg-${ink} ink-${ink}`}>
          <Icon size={22} aria-hidden />
        </span>
        <div className="grow">
          <div className="row tight">
            <p className="t-body-lg grow" style={{ fontWeight: unread ? 700 : 500 }}>
              {notification.title}
            </p>
            {unread && <span className="unread-dot" aria-hidden />}
          </div>
          <p className="t-body muted" style={{ marginTop: 2 }}>
            {notification.body}
          </p>
          <p className="t-small muted mt-xs">
            {formatFreshness(now.getTime() - notification.createdAt.getTime())}
          </p>
        </div>
      </div>
    </AppCard>
  );
}
