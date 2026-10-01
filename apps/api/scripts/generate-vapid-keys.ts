/**
 * Prints a fresh VAPID key pair for Web Push. Run once per environment:
 *
 *   npx ts-node scripts/generate-vapid-keys.ts
 *
 * The private key is a credential — it goes in the environment's secret
 * store, never in the repository. Changing it invalidates every browser
 * subscription, which then re-subscribe the next time the app is opened.
 */
import { generateVapidKeys } from '../src/infrastructure/push/web-push/web-push.crypto';

const { publicKey, privateKey } = generateVapidKeys();
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
