import { lazy, Suspense, useCallback, useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { LoadingBlock } from './components/ui';
import { canDispatch } from './domain/models';
import { AdminShell } from './screens/admin/AdminShell';
import { AuditScreen } from './screens/admin/AuditScreen';
import { FlagsScreen } from './screens/admin/FlagsScreen';
import { OverviewScreen } from './screens/admin/OverviewScreen';
import { RefundsScreen } from './screens/admin/RefundsScreen';
import { BillingScreen } from './screens/BillingScreen';
import { ConsoleShell } from './screens/ConsoleShell';
import { FleetScreen } from './screens/FleetScreen';
import { OrganizationPickerScreen } from './screens/OrganizationPickerScreen';
import { QueueScreen } from './screens/QueueScreen';
import { RosterScreen } from './screens/RosterScreen';
import { SeatsScreen } from './screens/SeatsScreen';
import { SignInScreen } from './screens/SignInScreen';
import { useOrganizations, useSession, useStore } from './state/context';
import { MessagingProvider } from './messaging/react';
import type { MessagingStore } from './messaging/store';
import { MessagesScreen } from './screens/messages/MessagesScreen';

// Loaded when first opened: the map library is most of its weight, and the
// queue — the screen every dispatcher starts on — should not wait for it.
const LiveMapScreen = lazy(() =>
  import('./screens/LiveMapScreen').then((m) => ({ default: m.LiveMapScreen })),
);

/**
 * Routes, and the redirects that matter — the same locations as
 * apps/ops_console/lib/app/router.dart.
 *
 * All of them are guard rails rather than authorisation. The server refuses a
 * signed-out caller, an organisation the caller has no membership in, and an
 * `/admin` request without platform standing — with the same 404 it uses for
 * a record that does not exist. These only decide which screen is worth
 * rendering, so a dispatcher never sits looking at a queue that is empty
 * because they are on the wrong screen.
 */
export function App({ messaging }: { messaging: MessagingStore }) {
  const { signedIn, organizationId } = useSession();
  const navigate = useNavigate();
  const openThread = useCallback(
    (id: string) => navigate(`/messages/${id}`),
    [navigate],
  );

  return (
    <MessagingProvider store={messaging} active={signedIn} openThread={openThread}>
      <Routes>
        <Route
          path="/sign-in"
          element={signedIn ? <Navigate to="/queue" replace /> : <SignInScreen />}
        />
        <Route element={<SignedInOnly />}>
          <Route
            path="/organizations"
            element={
              organizationId ? (
                <Navigate to="/queue" replace />
              ) : (
                <OrganizationPickerScreen />
              )
            }
          />
          {/*
          Administration is not scoped to an operator, so it sits outside the
          operator check. It is also the only surface a platform account with no
          membership can use; sending them to a picker they cannot satisfy
          would be a closed loop.
        */}
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<OverviewScreen />} />
            <Route path="audit" element={<AuditScreen />} />
            <Route path="flags" element={<FlagsScreen />} />
            <Route path="refunds" element={<RefundsScreen />} />
          </Route>
          <Route element={<OperatorChosen />}>
            <Route element={<ConsoleShell />}>
              <Route path="/queue" element={<QueueScreen />} />
              <Route
                path="/map"
                element={
                  <Suspense fallback={<LoadingBlock />}>
                    <LiveMapScreen />
                  </Suspense>
                }
              />
              <Route path="/roster" element={<RosterScreen />} />
              <Route path="/fleet" element={<FleetScreen />} />
              <Route path="/seats" element={<SeatsScreen />} />
              <Route path="/billing" element={<BillingScreen />} />
              <Route path="/messages" element={<MessagesScreen />} />
              <Route path="/messages/:conversationId" element={<MessagesScreen />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Routes>
    </MessagingProvider>
  );
}

function SignedInOnly() {
  const { signedIn } = useSession();
  return signedIn ? <Outlet /> : <Navigate to="/sign-in" replace />;
}

/**
 * Every console screen is scoped to one operator, so there is nothing to
 * render until one is picked. A chosen id that is no longer among the
 * memberships, or whose role can no longer dispatch — revoked while the tab
 * was open — goes back to the picker rather than rendering a queue the server
 * will refuse.
 */
function OperatorChosen() {
  const store = useStore();
  const { organizationId } = useSession();
  const organizations = useOrganizations();
  const list = organizations.value;
  const stillHeld =
    list?.some((o) => o.id === organizationId && canDispatch(o)) ?? true;

  useEffect(() => {
    if (!stillHeld) store.selectOrganization(null);
  }, [store, stillHeld]);

  if (!organizationId || !stillHeld) return <Navigate to="/organizations" replace />;
  if (!list && organizations.loading) return <LoadingBlock />;
  return <Outlet />;
}
