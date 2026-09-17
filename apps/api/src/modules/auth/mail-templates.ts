import type { MailMessage } from '../../infrastructure/mail/mail.port';

/**
 * Every email this service sends.
 *
 * They are collected here so the contentless rule can be read in one place and
 * checked by one test. FOUNDATION §9: a notification says something changed
 * and asks the recipient to open the app. It never carries an appointment
 * time, a clinic name, an address or a patient's name.
 *
 * Three of these are the exception, and the exception is bounded: verification,
 * password reset and invitation carry a **link**, because a link is the entire
 * purpose of the message. They still name no patient and no appointment. The
 * invitation names the inviter's first name only — without it the recipient
 * cannot tell a genuine invitation from a phishing attempt, which is a worse
 * outcome than the disclosure that some named person invited them somewhere.
 */

interface TemplateContext {
  appUrl: string;
  correlationId?: string;
}

function link(context: TemplateContext, path: string, token: string): string {
  const url = new URL(path, context.appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export function verificationEmail(
  context: TemplateContext,
  options: { to: string; token: string; expiresInHours: number },
): MailMessage {
  const url = link(context, '/verify-email', options.token);
  return {
    to: options.to,
    subject: 'Confirm your CareBridge email address',
    text: [
      'Someone — we hope you — created a CareBridge account with this email address.',
      '',
      'Confirm it by opening this link:',
      url,
      '',
      `The link works once and expires in ${options.expiresInHours} hours.`,
      '',
      'If this was not you, ignore this message. No account can be used with an address that is never confirmed.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

export function passwordResetEmail(
  context: TemplateContext,
  options: { to: string; token: string; expiresInMinutes: number },
): MailMessage {
  const url = link(context, '/reset-password', options.token);
  return {
    to: options.to,
    subject: 'Reset your CareBridge password',
    text: [
      'You asked to reset your CareBridge password.',
      '',
      'Open this link to choose a new one:',
      url,
      '',
      `The link works once and expires in ${options.expiresInMinutes} minutes.`,
      '',
      'If you did not ask for this, you can ignore this message — your password has not changed. Signing in normally cancels the request.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/**
 * Sent when a reset actually completes, and not suppressible.
 *
 * This is the message that turns a silent account takeover into a noticed one.
 * It is the only reliable signal a user gets that someone else changed their
 * password, so it is not subject to notification preferences.
 */
export function passwordChangedEmail(
  context: TemplateContext,
  options: { to: string },
): MailMessage {
  return {
    to: options.to,
    subject: 'Your CareBridge password was changed',
    text: [
      'The password on your CareBridge account was just changed, and every signed-in device has been signed out.',
      '',
      'If that was you, there is nothing to do.',
      '',
      'If it was not, reset your password immediately and contact support.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

export function invitationEmail(
  context: TemplateContext,
  options: {
    to: string;
    token: string;
    inviterFirstName: string;
    expiresInDays: number;
  },
): MailMessage {
  const url = link(context, '/accept-invitation', options.token);
  return {
    to: options.to,
    subject: 'You have been invited to a CareBridge care circle',
    text: [
      `${options.inviterFirstName} has invited you to help coordinate care for a family member on CareBridge.`,
      '',
      'Accept the invitation here:',
      url,
      '',
      `The link works once, expires in ${options.expiresInDays} days, and only works when you are signed in with this email address.`,
      '',
      'If you were not expecting this, ignore it. The invitation cannot be used by anyone else.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/**
 * The generic one every non-security notification uses.
 *
 * It genuinely says nothing. That is not laziness — an email subject line is
 * rendered in a notification banner on a locked phone, and "Cardiology
 * follow-up moved to Thursday" on a kitchen table tells the room something the
 * patient may not have chosen to share.
 */
export function notificationEmail(
  context: TemplateContext,
  options: { to: string; title: string },
): MailMessage {
  return {
    to: options.to,
    subject: 'There is an update in CareBridge',
    text: [
      options.title,
      '',
      'Open CareBridge to see the detail:',
      context.appUrl,
      '',
      'We keep the specifics out of email on purpose — an inbox is read in more places than an app is.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

// ─── account deletion ───────────────────────────────────────────────────────

/**
 * The link the public deletion form sends.
 *
 * Play requires deletion to be requestable at a URL without installing the
 * app, so whoever fills that form is by definition not signed in. This link is
 * what proves they hold the address — the same mechanism as a password reset,
 * and deliberately the same shape, because getting the security properties
 * right once is the reason those two share an implementation.
 *
 * Phrased so that receiving it unexpectedly is self-explanatory. The person who
 * did not ask for this needs to know that ignoring it is safe and sufficient.
 */
export function accountDeletionLinkEmail(
  context: TemplateContext,
  options: { to: string; token: string; expiresInMinutes: number },
): MailMessage {
  const url = link(context, '/delete-account.html', options.token);
  return {
    to: options.to,
    subject: 'Confirm you want your CareBridge account deleted',
    text: [
      'Somebody asked for the CareBridge account with this email address to be deleted.',
      '',
      'If that was you, confirm it here:',
      url,
      '',
      `The link works once and expires in ${options.expiresInMinutes} minutes.`,
      '',
      'If it was not you, ignore this message. Nothing has been deleted and nothing will be — the request does not start until this link is opened.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/**
 * Sent the moment a deletion is scheduled, and not suppressible.
 *
 * Like `passwordChangedEmail`, this is the message that turns a silent
 * destructive action into a noticed one — and unlike a password change, the
 * window to undo it is thirty days rather than a support call. It carries the
 * date in plain words because "your grace period expires" is not a sentence
 * anybody should have to parse about their own data.
 */
export function accountDeletionScheduledEmail(
  context: TemplateContext,
  options: { to: string; executesOn: string; graceDays: number },
): MailMessage {
  return {
    to: options.to,
    subject: 'Your CareBridge account is scheduled for deletion',
    text: [
      `Your CareBridge account is scheduled to be deleted on ${options.executesOn}.`,
      '',
      'Every device has already been signed out, and a copy of your data was provided when you made the request.',
      '',
      `If you change your mind, just sign in again before then — signing in cancels the deletion. You have ${options.graceDays} days.`,
      '',
      'Some records will not be destroyed: invoices, payments and the log of actions taken on the account are kept as long as the law requires. What goes is everything that identifies you on them.',
      '',
      'If you did not ask for this, sign in now to cancel it and change your password.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/** Confirms the undo, so cancelling is as visible as requesting. */
export function accountDeletionCancelledEmail(
  context: TemplateContext,
  options: { to: string },
): MailMessage {
  return {
    to: options.to,
    subject: 'Your CareBridge account is no longer scheduled for deletion',
    text: [
      'The deletion scheduled on your CareBridge account has been cancelled, because you signed in.',
      '',
      'Nothing was removed and your account is working normally.',
      '',
      'If you still want it deleted, you can ask again from Settings, or at the deletion page on our website.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}

/**
 * The last message this address will ever receive from us.
 *
 * Sent after the erasure commits, using the address captured inside the same
 * transaction — after this there is no row left that knows where to write. It
 * says what survived, because a person who is told "deleted" and later
 * discovers an invoice with their name on it has been misled, and the honest
 * version of that sentence is cheap to send now.
 */
export function accountDeletedEmail(
  context: TemplateContext,
  options: { to: string },
): MailMessage {
  return {
    to: options.to,
    subject: 'Your CareBridge account has been deleted',
    text: [
      'Your CareBridge account has been deleted. Your name, address, phone number, sign-in details and notification history are gone.',
      '',
      'Invoices, payments and the log of actions taken on the account remain, for as long as financial and audit rules require — with nothing on them that identifies you.',
      '',
      'This is the last message you will receive from us at this address.',
    ].join('\n'),
    correlationId: context.correlationId,
  };
}
