#!/usr/bin/env node
/**
 * Line-coverage floors for the Flutter packages, over the lcov file
 * `flutter test --coverage` writes.
 *
 * The API enforces its own thresholds through jest. Dart has no equivalent, so
 * this reads the same lcov format and applies the same idea: a floor that
 * catches tests being deleted rather than fixed, not a target anybody should
 * feel finished at.
 *
 * Usage:
 *   flutter test --coverage && node scripts/check-dart-coverage.mjs
 *   (cd apps/driver_app && flutter test --coverage)
 *     && node scripts/check-dart-coverage.mjs apps/driver_app
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PACKAGE = (process.argv[2] ?? '.').replace(/\/+$/, '');
const LCOV = `${PACKAGE === '.' ? '' : PACKAGE + '/'}coverage/lcov.info`;

/**
 * Floors are set just under what the tree has today. Two of them are the ones
 * that matter:
 *
 *   lib/domain — the mirror of the server's rules. It decides nothing, but a
 *       wrong mirror shows a price that disagrees with the invoice or offers a
 *       control the API then refuses. The server's copy of these rules is at
 *       100%; this one is not, and that gap is worth closing.
 *   lib/core  — Money, geo and the formatters. Same argument, one layer down.
 *
 * lib/features is UI, covered only where a widget test exercises it. It is
 * inside the overall floor rather than given one of its own, so that adding a
 * screen does not fail the build for the sin of being a screen.
 */
/**
 * The driver app's floors are higher, and deliberately so. Its `lib/domain`
 * is not a mirror of anything — the cadence rules exist only there, and
 * nothing on the server would catch them being wrong. `lib/data` holds the
 * offline queue, which is the one piece of state in this system whose failure
 * mode is a silent hole in somebody's journey record.
 */
const FLOORS = {
  '.': [
    { prefix: 'lib/domain/', minimum: 58 },
    { prefix: 'lib/core/', minimum: 47 },
    { prefix: 'lib/', minimum: 29 },
  ],
  'apps/driver_app': [
    // 100, the same standard the API's `src/domain` is held to and for the
    // same reason: these are pure rules with no I/O, so there is nothing here
    // that is hard to reach and no excuse for a line nothing exercises.
    { prefix: 'lib/domain/', minimum: 100 },
    { prefix: 'lib/data/', minimum: 70 },
    { prefix: 'lib/', minimum: 60 },
  ],
};

const THRESHOLDS = FLOORS[PACKAGE];
if (!THRESHOLDS) {
  console.error(
    `No coverage floors defined for "${PACKAGE}". Add them in this file — a ` +
      'package that runs the check without floors passes it without meaning it.',
  );
  process.exit(1);
}

// The generated client is analysed and compiled, never unit-tested: it has no
// logic of its own, and a test over it would be a test of the generator.
const EXCLUDED = ['packages/'];

// lcov paths are written relative to wherever `flutter test` ran, which is the
// repository root — the same place this script is invoked from. Absolute paths
// are handled too rather than silently producing a prefix that matches nothing.
const ROOT = resolve(process.cwd(), PACKAGE).replace(/\/*$/, '') + '/';
const relative = (file) =>
  file.startsWith(ROOT) ? file.slice(ROOT.length) : file.replace(/^\.\//, '');

const lcov = await readFile(LCOV, 'utf8').catch(() => {
  console.error(`${LCOV} not found. Run: flutter test --coverage`);
  process.exit(1);
});

/** @type {Array<{file: string, total: number, hit: number}>} */
const files = [];
let current = null;

for (const line of lcov.split('\n')) {
  if (line.startsWith('SF:')) {
    current = { file: relative(line.slice(3).trim()), total: 0, hit: 0 };
    files.push(current);
  } else if (line.startsWith('DA:') && current) {
    const [, hits] = line.slice(3).trim().split(',');
    current.total += 1;
    if (Number(hits) > 0) current.hit += 1;
  }
}

const counted = files.filter(
  (f) => !EXCLUDED.some((prefix) => f.file.startsWith(prefix)),
);

if (counted.length === 0) {
  console.error(`${LCOV} covers no files. Was the run empty?`);
  process.exit(1);
}

let failed = false;

for (const { prefix, minimum } of THRESHOLDS) {
  const matching = counted.filter((f) => f.file.startsWith(prefix));
  const total = matching.reduce((sum, f) => sum + f.total, 0);
  const hit = matching.reduce((sum, f) => sum + f.hit, 0);

  if (total === 0) {
    // A prefix that matches nothing is a threshold that silently stopped
    // applying — usually because a directory moved.
    console.error(`✗ ${prefix} matched no covered files. Is the path still right?`);
    failed = true;
    continue;
  }

  const percent = (hit / total) * 100;
  const ok = percent >= minimum;
  if (!ok) failed = true;

  console.log(
    `${ok ? '✓' : '✗'} ${prefix.padEnd(14)} ${percent.toFixed(2).padStart(6)}%  ` +
      `(${hit}/${total} lines, floor ${minimum}%)`,
  );
}

if (failed) {
  console.error(
    '\nLine coverage fell below its floor. Add the tests, or — if the drop is ' +
      'deliberate and understood — change the floor in this file and say why ' +
      'in the commit.',
  );
  process.exit(1);
}
