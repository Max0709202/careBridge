/**
 * Getting someone's attention when a message or a call arrives. Shared (see
 * model.ts).
 *
 * Three things, each for a different situation:
 *
 *  - **The tab title** carries the unread count — "(3) CareBridge" — which is
 *    visible from another tab without anything popping up.
 *  - **A short chime**, only if the person has turned sound on here. Browsers
 *    refuse audio before a user gesture anyway; a setting makes that explicit.
 *  - **A system notification**, only while the page is hidden and only if
 *    the person granted permission. Content-free, like push (FOUNDATION §9):
 *    a notification on a shared screen says that something happened, never
 *    who or what.
 */

const SOUND_KEY = 'carebridge.messaging.sound';

export class Attention {
  private readonly baseTitle: string;
  private audio: AudioContext | null = null;

  constructor(private readonly storage: Storage | undefined = safeLocalStorage()) {
    this.baseTitle =
      typeof document !== 'undefined' ? document.title.replace(/^\(\d+\)\s*/, '') : '';
  }

  /** "(3) CareBridge", or the plain title at zero. */
  setUnread(count: number): void {
    if (typeof document === 'undefined') return;
    document.title =
      count > 0 ? `(${count > 99 ? '99+' : count}) ${this.baseTitle}` : this.baseTitle;
  }

  get soundOn(): boolean {
    try {
      return this.storage?.getItem(SOUND_KEY) === 'on';
    } catch {
      return false;
    }
  }

  setSound(on: boolean): void {
    try {
      this.storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // Remembered for this page only.
    }
    if (on) this.chime();
  }

  get notificationsSupported(): boolean {
    return typeof Notification !== 'undefined';
  }

  get notificationsAllowed(): boolean {
    return this.notificationsSupported && Notification.permission === 'granted';
  }

  /** Must be called from a click: browsers ignore a permission request made any other way. */
  async requestNotifications(): Promise<boolean> {
    if (!this.notificationsSupported) return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }

  /** A new message or call. `urgent` rings twice — used for calls. */
  alert(input: {
    title: string;
    body: string;
    tag: string;
    urgent?: boolean;
    onOpen?: () => void;
  }): void {
    if (this.soundOn) {
      this.chime();
      if (input.urgent) setTimeout(() => this.chime(), 400);
    }
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden')
      return;
    if (!this.notificationsAllowed) return;
    try {
      const notification = new Notification(input.title, {
        body: input.body,
        tag: input.tag,
      });
      notification.onclick = () => {
        window.focus();
        input.onOpen?.();
        notification.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker. The title still counts.
    }
  }

  private chime(): void {
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;
      this.audio ??= new AudioCtor();
      const ctx = this.audio;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch {
      // No audio here. The title and the badge still say it.
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
