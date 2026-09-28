import { Compass } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { Button, EmptyState, Page } from './components/ui';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { JobScreen } from './screens/JobScreen';
import { SignInScreen } from './screens/SignInScreen';
import { TodayScreen } from './screens/TodayScreen';
import { useDriver, useStore } from './state/context';

/**
 * Three screens and one redirect — the same locations as the Flutter app's
 * lib/app/router.dart. The guard is a guard rail, not authorisation: it exists
 * so a driver never sits looking at a list that is empty because the session
 * expired in a car park.
 */
export function App() {
  const store = useStore();
  const { signedIn } = useDriver();

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
    <Routes>
      <Route path="/sign-in" element={signedIn ? <Navigate to="/today" replace /> : <SignInScreen />} />
      <Route element={<SignedInOnly />}>
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayScreen />} />
        <Route path="/documents" element={<DocumentsScreen />} />
        <Route path="/job/:rideId" element={<JobScreen />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
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
