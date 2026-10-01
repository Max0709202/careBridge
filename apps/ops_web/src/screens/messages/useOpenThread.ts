import { useNavigate } from 'react-router-dom';

import { useRun } from '../../components/useRun';
import type { OpenSubject } from '../../messaging/model';
import { useMessagingStore } from '../../messaging/react';

/** Finds or opens a thread and takes the dispatcher to it. */
export function useOpenThread() {
  const store = useMessagingStore();
  const navigate = useNavigate();
  const { run, busy } = useRun();

  const openThread = async (subject: OpenSubject) => {
    const result = await run(() => store.open(subject));
    if (result.ok) navigate(`/messages/${result.value.id}`);
  };

  return { openThread, busy };
}
