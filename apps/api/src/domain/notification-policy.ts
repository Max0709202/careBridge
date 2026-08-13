/**
 * Which channels a notification kind may use, and which are on by default.
 *
 * Pure data plus one resolution function, kept out of the service so that the
 * two rules below can be asserted exhaustively rather than sampled:
 *
 *   1. **Every kind has a policy.** A new `NotificationKind` that nobody added
 *      here is a compile error, not a notification that silently goes nowhere.
 *   2. **In-app is never optional.** The centre inside the app is the record of
 *      what happened; letting a user switch it off would make the timeline
 *      lie by omission, and the timeline is what disputes are resolved with.
 *      Email and push are the channels that reach outside the app, and those
 *      are the ones a person gets to control.
 *
 * Defaults are deliberately quiet. Push is on only for the events a person is
 * actually waiting on — the ones where the alternative is a phone call to
 * dispatch. Email is on only for the events someone might need a record of.
 * A product that pushes everything gets its notifications turned off wholesale,
 * and then the one that mattered does not arrive either.
 */

export type NotificationKindName =
  | 'appointmentCreated'
  | 'appointmentReminder'
  | 'appointmentChanged'
  | 'appointmentCanceled'
  | 'rideRequested'
  | 'driverAssigned'
  | 'driverEnRoute'
  | 'driverArrivingSoon'
  | 'driverArrived'
  | 'patientPickedUp'
  | 'patientArrived'
  | 'rideDelayed'
  | 'rideCompleted'
  | 'rideCanceled'
  | 'accessGranted';

export type ChannelName = 'inApp' | 'email' | 'push';

export interface ChannelPolicy {
  /** May the user turn this channel off for this kind? */
  configurable: boolean;
  /** Is it on for someone who has never touched the settings screen? */
  defaultEnabled: boolean;
}

export type KindPolicy = Record<ChannelName, ChannelPolicy>;

const ALWAYS_ON: ChannelPolicy = { configurable: false, defaultEnabled: true };
const ON: ChannelPolicy = { configurable: true, defaultEnabled: true };
const OFF: ChannelPolicy = { configurable: true, defaultEnabled: false };

function policy(email: ChannelPolicy, push: ChannelPolicy): KindPolicy {
  return { inApp: ALWAYS_ON, email, push };
}

export const NOTIFICATION_POLICY: Record<NotificationKindName, KindPolicy> = {
  // Scheduling. Worth an email — a person may want it in their calendar
  // workflow — but not worth interrupting them.
  appointmentCreated: policy(ON, OFF),
  appointmentChanged: policy(ON, ON),
  appointmentCanceled: policy(ON, ON),

  // The reminder is the product doing its job. Both channels on.
  appointmentReminder: policy(ON, ON),

  // Requesting transport is an action the requester just took; telling the
  // rest of the circle in-app is enough.
  rideRequested: policy(OFF, OFF),

  // Assignment is the first moment there is something concrete to know: a
  // name, a vehicle, a time.
  driverAssigned: policy(ON, ON),

  // The live sequence. These are the two hours of silence the product exists
  // to remove, so push is on and email is off — nobody wants six emails
  // during one journey.
  driverEnRoute: policy(OFF, ON),
  driverArrivingSoon: policy(OFF, ON),
  driverArrived: policy(OFF, ON),
  patientPickedUp: policy(OFF, ON),
  patientArrived: policy(OFF, ON),

  // Exceptions. Always worth the interruption.
  rideDelayed: policy(ON, ON),
  rideCanceled: policy(ON, ON),

  // Completion is a receipt, not an alert.
  rideCompleted: policy(ON, OFF),

  // Someone gained access to a patient's record. A security-relevant change to
  // who can see a vulnerable person's address and movements, so it reaches
  // outside the app on both channels.
  accessGranted: policy(ON, ON),
};

export const ALL_CHANNELS: readonly ChannelName[] = ['inApp', 'email', 'push'];

/**
 * The channels to actually use, given the stored overrides.
 *
 * A non-configurable channel ignores its override entirely rather than
 * trusting that nothing ever wrote one — a row can arrive from an old client,
 * a migration or a support script, and the invariant should not depend on
 * every writer having been careful.
 */
export function resolveChannels(
  kind: NotificationKindName,
  overrides: Partial<Record<ChannelName, boolean>> = {},
): ChannelName[] {
  const kindPolicy = NOTIFICATION_POLICY[kind];

  return ALL_CHANNELS.filter((channel) => {
    const channelPolicy = kindPolicy[channel];
    if (!channelPolicy.configurable) return channelPolicy.defaultEnabled;
    return overrides[channel] ?? channelPolicy.defaultEnabled;
  });
}

/** What the settings screen renders. Non-configurable channels are shown as fixed. */
export function preferenceMatrix(): Array<{
  kind: NotificationKindName;
  channel: ChannelName;
  configurable: boolean;
  defaultEnabled: boolean;
}> {
  return (Object.keys(NOTIFICATION_POLICY) as NotificationKindName[]).flatMap((kind) =>
    ALL_CHANNELS.map((channel) => ({
      kind,
      channel,
      ...NOTIFICATION_POLICY[kind][channel],
    })),
  );
}
