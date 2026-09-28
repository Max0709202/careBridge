import { useCallback, useState } from 'react';

import { useFeedback } from './feedback';

/**
 * Runs an action, shows a failure as a toast, and tracks whether one is in
 * flight so its button can be disabled — the double-tap guard every mutating
 * control in the app has.
 */
export function useRun() {
  const { showFailure } = useFeedback();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
      setBusy(true);
      try {
        return { ok: true, value: await action() };
      } catch (error) {
        showFailure(error);
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [showFailure],
  );

  return { run, busy };
}
