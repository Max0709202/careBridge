import { Compass } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { Button, EmptyState, Page } from './components/ui';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { JobScreen } from './screens/JobScreen';
import { SignInScreen } from './screens/SignInScreen';
import { TodayScreen } from './screens/TodayScreen';
import { useDriver, useStore } from './state/context';
import { MessagingProvider } from './messaging/react';
import type { MessagingStore } from './messaging/store';
import { CallSettingsScreen } from './screens/messages/CallSettingsScreen';
import { ConversationScreen } from './screens/messages/ConversationScreen';
import { IncomingCallBanner } from './screens/messages/IncomingCallBanner';
import { MessagesScreen } from './screens/messages/MessagesScreen';

/**
 * Three screens and one redirect — the same locations as the Flutter app's
 * lib/app/router.dart. The guard is a guard rail, not authorisation: it exists
 * so a driver never sits looking at a list that is empty because the session
 * expired in a car park.
 */
export function App({ messaging }: { messaging: MessagingStore }) {
  const store = useStore();
  const { signedIn } = useDriver();
  const navigate = useNavigate();
  const openThread = useCallback((id: string) => navigate(`/messages/${id}`), [navigate]);

  // A phone that was locked for twenty minutes should not show twenty-minute
  // old work when it comes back: re-read the moment the page is on screen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && store.getState().signedIn) void store.refreshJobs();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [store]);

  return (
    <MessagingProvider store={messaging} active={signedIn} openThread={openThread}>
      <IncomingCallBanner />
      <Routes>
      <Route path="/sign-in" element={signedIn ? <Navigate to="/today" replace /> : <SignInScreen />} />
      <Route element={<SignedInOnly />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayScreen />} />
        <Route path="/documents" element={<DocumentsScreen />} />
        <Route path="/job/:rideId" element={<JobScreen />} />
        <Route path="/messages" element={<MessagesScreen />} />
        <Route path="/messages/:conversationId" element={<ConversationScreen />} />
        <Route path="/settings/calls" element={<CallSettingsScreen />} />
      </Route>
      <Route path="*" element={<NotFound />} />
      </Routes>
    </MessagingProvider>
  );
}

function SignedInOnly() {
  const { signedIn } = useDriver();
  return signedIn ? <Outlet /> : <Navigate to="/sign-in" replace />;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <Page title="">
      <EmptyState
        icon={Compass}
        title="That page does not exist"
        message="The link may be out of date."
        action={<Button onClick={() => navigate('/today')}>Back to today</Button>}
      />
    </Page>
  );
}
