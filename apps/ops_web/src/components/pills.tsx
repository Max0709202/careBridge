/**
 * Band labels that never rely on colour alone (WCAG 1.4.1). Red-for-overdue
 * against green-for-fine is the obvious encoding and the one roughly 8% of men
 * cannot read, so every pill carries an icon and a word and the colour is
 * reinforcement rather than information.
 */
import {
  BadgeCheck,
  CalendarClock,
  CalendarX,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CirclePause,
  Clock,
  Hourglass,
  Mail,
  UserX,
  type LucideIcon,
} from 'lucide-react';

import { subscriptionStatusLabel, type SubscriptionStatus } from '../domain/billing';
import { driverStatusLabel, urgencyLabel, type DispatchUrgency, type DriverStatus } from '../domain/dispatch';

/** The four semantic tones from the Flutter theme's OpsColors. */
export type Tone = 'overdue' | 'imminent' | 'soon' | 'later' | 'positive';

function Pill(props: { tone: Tone; icon: LucideIcon; label: string; ariaLabel: string }) {
  const Icon = props.icon;
  return (
    <span className={`pill tone-${props.tone}`} aria-label={props.ariaLabel} role="img">
      <Icon size={15} aria-hidden />
      <span aria-hidden>{props.label}</span>
    </span>
  );
}

const urgencyLook: Record<DispatchUrgency, [Tone, LucideIcon]> = {
  overdue: ['overdue', CircleAlert],
  imminent: ['imminent', Clock],
  soon: ['soon', CalendarClock],
  later: ['later', CalendarClock],
};

export function UrgencyPill({ urgency }: { urgency: DispatchUrgency }) {
  const [tone, icon] = urgencyLook[urgency];
  const label = urgencyLabel[urgency];
  return <Pill tone={tone} icon={icon} label={label} ariaLabel={`Urgency: ${label}`} />;
}

const driverLook: Record<DriverStatus, [Tone, LucideIcon]> = {
  approved: ['positive', BadgeCheck],
  pendingApproval: ['imminent', Hourglass],
  suspended: ['overdue', CirclePause],
  invited: ['soon', Mail],
  offboarded: ['later', UserX],
};

export function DriverStatusPill({ status }: { status: DriverStatus }) {
  const [tone, icon] = driverLook[status];
  const label = driverStatusLabel[status];
  return <Pill tone={tone} icon={icon} label={label} ariaLabel={`Driver status: ${label}`} />;
}

const subscriptionLook: Record<SubscriptionStatus, [Tone, LucideIcon]> = {
  active: ['positive', CircleCheck],
  trialing: ['soon', Clock],
  pastDue: ['overdue', CircleAlert],
  pendingCancellation: ['imminent', CalendarX],
  canceled: ['later', CircleMinus],
  expired: ['later', CircleMinus],
};

export function SubscriptionPill({ status }: { status: SubscriptionStatus }) {
  const [tone, icon] = subscriptionLook[status];
  const label = subscriptionStatusLabel[status];
  return <Pill tone={tone} icon={icon} label={label} ariaLabel={`Subscription: ${label}`} />;
}
