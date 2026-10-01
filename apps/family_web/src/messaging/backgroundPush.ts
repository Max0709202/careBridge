/**
 * Background notifications in a browser — Web Push. Shared (see model.ts).
 *
 * Opt-in, from a settings switch: a permission prompt nobody asked for is the
 * one most people answer "block" to, permanently. What arrives is the same
 * content-free text as a phone push: that something happened, never who or
 * what. The service worker (`public/sw.js`) shows it and, when tapped, opens
 * the thread or trip it is about.
 */
import type { ApiTransport } from '../api/transport';

export type BackgroundPushStatus = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';
export type AppTarget = 'family' | 'driver' | 'ops';

const DEVICE_KEY = 'carebridge.webPush.deviceId';

export class BackgroundPush {
  constructor(
    private readonly transport: ApiTransport,
    private readonly appTarget: AppTarget,
    private readonly storage: Storage | undefined = safeLocalStorage(),
  ) {}

  static get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      typeof Notification !== 'undefined'
    );
  }

  async status(): Promise<BackgroundPushStatus> {
    if (!BackgroundPush.supported) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    if (!(await this.publicKey())) return 'unavailable';
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? 'on' : 'off';
  }

  /** Must run from a click. Asks permission, subscribes, and registers the subscription. */
  async enable(): Promise<BackgroundPushStatus> {
    if (!BackgroundPush.supported) return 'unsupported';
    const key = await this.publicKey();
    if (!key) return 'unavailable';
    if ((await Notification.requestPermission()) !== 'granted') return 'blocked';

    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(key),
      }));

    const device = await this.transport.send<{ id?: string }>('POST', '/me/devices', {
      body: { token: JSON.stringify(subscription.toJSON()), platform: 'web', appTarget: this.appTarget },
    });
    if (device.id) this.write(device.id);
    return 'on';
  }

  async disable(): Promise<BackgroundPushStatus> {
    const id = this.read();
    if (id) {
      try {
        await this.transport.send('DELETE', `/me/devices/${encodeURIComponent(id)}`);
      } catch {
        // Unsubscribing below is enough: the push service then refuses, and
        // the server stops trying on the first refusal.
      }
      this.write(null);
    }
    await BackgroundPush.forget();
    return 'off';
  }

  /**
   * On sign-out. Needs no session: the subscription is dropped in the
   * browser, so the next person at a shared computer is not notified about
   * the last one's conversations.
   */
  static async forget(): Promise<void> {
    if (!BackgroundPush.supported) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      // Nothing registered.
    }
    try {
      window.localStorage.removeItem(DEVICE_KEY);
    } catch {
      // Storage blocked: nothing was stored either.
    }
  }

  private async publicKey(): Promise<string | null> {
    try {
      const json = await this.transport.send<{ publicKey?: string | null }>('GET', '/me/devices/web-push-key');
      return json.publicKey ?? null;
    } catch {
      return null;
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(DEVICE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private write(id: string | null): void {
    try {
      if (id) this.storage?.setItem(DEVICE_KEY, id);
      else this.storage?.removeItem(DEVICE_KEY);
    } catch {
      // Remembered for this page only.
    }
  }
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
