/**
 * How each status looks: an icon and an ink, always paired with the label.
 * Mirrors rideStatusVisual / appointmentStatusVisual in status_pill.dart.
 */
import {
  CalendarCheck,
  Calendar,
  Car,
  CarFront,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleX,
  Clock,
  Hospital,
  Hourglass,
  MapPin,
  Navigation,
  NotebookPen,
  Armchair,
  RefreshCwOff,
  Search,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';

import {
  appointmentStatusLabel,
  rideStatusLabel,
  type AppointmentStatus,
  type RideStatus,
} from '../domain/statuses';
import { StatusPill, type Ink } from './ui';

export interface StatusVisual {
  icon: LucideIcon;
  ink: Ink;
}

export const rideStatusVisual: Record<RideStatus, StatusVisual> = {
  draft: { icon: NotebookPen, ink: 'neutral' },
  requested: { icon: Hourglass, ink: 'info' },
  awaitingAssignment: { icon: Search, ink: 'info' },
  assigned: { icon: UserRoundCheck, ink: 'info' },
  driverAccepted: { icon: CircleCheck, ink: 'info' },
  driverEnRoute: { icon: CarFront, ink: 'info' },
  driverArrived: { icon: MapPin, ink: 'caution' },
  passengerOnboard: { icon: Armchair, ink: 'positive' },
  inProgress: { icon: Navigation, ink: 'positive' },
  arrivedAtDestination: { icon: Hospital, ink: 'positive' },
  completed: { icon: CircleCheckBig, ink: 'positive' },
  canceled: { icon: CircleX, ink: 'neutral' },
  noShow: { icon: CircleAlert, ink: 'critical' },
  reassignmentRequired: { icon: RefreshCwOff, ink: 'critical' },
};

export const appointmentStatusVisual: Record<AppointmentStatus, StatusVisual> = {
  draft: { icon: NotebookPen, ink: 'neutral' },
  scheduled: { icon: Calendar, ink: 'info' },
  confirmed: { icon: CalendarCheck, ink: 'info' },
  patientPreparing: { icon: Clock, ink: 'caution' },
  transportationScheduled: { icon: Car, ink: 'info' },
  patientEnRoute: { icon: Navigation, ink: 'positive' },
  patientArrived: { icon: Hospital, ink: 'positive' },
  completed: { icon: CircleCheckBig, ink: 'positive' },
  canceled: { icon: CircleX, ink: 'neutral' },
  missed: { icon: CircleAlert, ink: 'critical' },
};

export function RideStatusPill({
  status,
  outlined,
}: {
  status: RideStatus;
  outlined?: boolean;
}) {
  const visual = rideStatusVisual[status];
  return (
    <StatusPill
      label={rideStatusLabel[status]}
      icon={visual.icon}
      ink={visual.ink}
      outlined={outlined}
    />
  );
}

export function AppointmentStatusPill({ status }: { status: AppointmentStatus }) {
  const visual = appointmentStatusVisual[status];
  return (
    <StatusPill
      label={appointmentStatusLabel[status]}
      icon={visual.icon}
      ink={visual.ink}
    />
  );
}
