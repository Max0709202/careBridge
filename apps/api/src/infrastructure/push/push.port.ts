/**
 * Outbound push, independent of FCM.
 *
 * FCM covers both platforms (T8, FCM → APNs for iOS), so there is one adapter
 * — but the port is what keeps a later APNs-direct or web-push adapter from
 * being a rewrite, and what lets tests assert on what would have been sent.
 */

export interface PushMessage {
  tokens: string[];
  title: string;
  /**
   * Contentless by policy (FOUNDATION §9). A phone on a kitchen table is
   * readable by whoever is in the room, and for an older adult that may
   * include the person they most need privacy from. Push bodies say something
   * changed and ask the recipient to open the app.
   */
  body: string;
  /** Deep-link routing only: entity ids and a kind, never names or times. */
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  /**
   * Tokens FCM reported as permanently gone. The caller marks them invalid so
   * we stop paying to push to an app that has been uninstalled.
   */
  invalidTokens: string[];
}

export interface PushPort {
  readonly driver: 'fcm' | 'log';
  send(message: PushMessage): Promise<PushResult>;
}

export const PUSH = Symbol('PUSH');
