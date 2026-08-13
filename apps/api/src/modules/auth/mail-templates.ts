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
