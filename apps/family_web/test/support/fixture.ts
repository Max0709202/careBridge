import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { components } from '../../src/api/schema';

/** The Flutter app's captured snapshot, shared rather than copied. */
export function loadSnapshot(): components['schemas']['CareStateDto'] {
  const path = resolve(__dirname, '../../../../test/fixtures/care_state_snapshot.json');
  return JSON.parse(readFileSync(path, 'utf8')) as components['schemas']['CareStateDto'];
}

export const Seeded = {
  eleanor: '00000000-0000-4000-8000-000000000010',
  frank: '00000000-0000-4000-8000-000000000011',
  nextAppointment: '00000000-0000-4000-8000-000000000050',
  outboundRide: '00000000-0000-4000-8000-000000000060',
} as const;
