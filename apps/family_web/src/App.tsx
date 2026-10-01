import { Bell, CalendarDays, Compass, House, Settings } from 'lucide-react';
import { useCallback, useEffect, type ReactNode } from 'react';
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { Button, EmptyState, Page } from './components/ui';
import { isSignedIn, unreadNotificationCount } from './state/careState';
import { useCare } from './state/context';
import { AcceptInvitationScreen } from './screens/auth/AcceptInvitationScreen';
import { ForgotPasswordScreen, ResetPasswordScreen } from './screens/auth/PasswordResetScreens';
import { RegisterScreen } from './screens/auth/RegisterScreen';
import { SignInScreen } from './screens/auth/SignInScreen';
import { VerifyEmailScreen } from './screens/auth/VerifyEmailScreen';
import { AppointmentDetailScreen } from './screens/appointments/AppointmentDetailScreen';
import { AppointmentFormScreen } from './screens/appointments/AppointmentFormScreen';
import { AppointmentsScreen } from './screens/appointments/AppointmentsScreen';
import { DashboardScreen } from './screens/dashboard/DashboardScreen';
import { NotificationsScreen } from './screens/notifications/NotificationsScreen';
import { CareCircleScreen } from './screens/patients/CareCircleScreen';
import { PatientDetailScreen } from './screens/patients/PatientDetailScreen';
import { PatientFormScreen } from './screens/patients/PatientFormScreen';
import { RideDetailScreen } from './screens/rides/RideDetailScreen';
import { RideRequestScreen } from './screens/rides/RideRequestScreen';
import { TrackingScreen } from './screens/rides/TrackingScreen';
import { AccountSecurityScreen } from './screens/settings/AccountSecurityScreen';
import { DeleteAccountScreen } from './screens/settings/DeleteAccountScreen';
import { NotificationPreferencesScreen } from './screens/settings/NotificationPreferencesScreen';
import { PlanScreen } from './screens/settings/PlanScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { TwoFactorScreen } from './screens/settings/TwoFactorScreen';
import { MessagingProvider } from './messaging/react';
import type { MessagingStore } from './messaging/store';
import { CallSettingsScreen } from './screens/messages/CallSettingsScreen';
import { ConversationScreen } from './screens/messages/ConversationScreen';
import { IncomingCallBanner } from './screens/messages/IncomingCallBanner';

/**
 * The route table — the same locations as lib/app/router.dart, so a link that
 * works in one app works in the other.
 */
export function App({ messaging }: { messaging: MessagingStore }) {
  const state = useCare();
  const navigate = useNavigate();
  const openThread = useCallback((id: string) => navigate(`/messages/${id}`), [navigate]);

  // Simplified mode raises the text floor for the whole document.
  useEffect(() => {
    document.documentElement.classList.toggle('simplified', state.simplifiedMode);
  }, [state.simplifiedMode]);

  return (
    <MessagingProvider store={messaging} active={isSignedIn(state)} openThread={openThread}>
      <IncomingCallBanner />
      <Routes>
      <Route element={<SignedOutOnly />}>
        <Route path="/sign-in" element={<SignInScreen />} />
        <Route path="/register" element={<RegisterScreen />} />
      </Route>

      {/* Reached from an email, signed in or not. */}
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route path="/verify-email" element={<VerifyEmailScreen />} />

      <Route element={<SignedInOnly />}>
        <Route element={<HomeShell />}>
          <Route path="/" element={<DashboardScreen />} />
          <Route path="/appointments" element={<AppointmentsScreen />} />
          {/* Declared before ':id' in spirit — react-router ranks static segments first. */}
          <Route path="/appointments/new" element={<AppointmentFormScreen />} />
          <Route path="/appointments/:id" element={<AppointmentDetailScreen />} />
          <Route path="/appointments/:id/transport" element={<RideRequestScreen />} />
          <Route path="/notifications" element={<NotificationsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/security" element={<AccountSecurityScreen />} />
          <Route path="/settings/security/two-factor" element={<TwoFactorScreen />} />
          <Route path="/settings/security/delete" element={<DeleteAccountScreen />} />
          <Route path="/settings/notifications" element={<NotificationPreferencesScreen />} />
          <Route path="/settings/plan" element={<PlanScreen />} />
          <Route path="/settings/calls" element={<CallSettingsScreen />} />
        </Route>

        {/* Full-screen: tracking and forms get the whole screen, no navigation bar. */}
        <Route path="/accept-invitation" element={<AcceptInvitationScreen />} />
        <Route path="/patients/new" element={<PatientFormScreen />} />
        <Route path="/patients/:id" element={<PatientDetailScreen />} />
        <Route path="/patients/:id/care-circle" element={<CareCircleScreen />} />
        <Route path="/patients/:id/edit" element={<PatientFormScreen />} />
        <Route path="/rides/:id" element={<RideDetailScreen />} />
        <Route path="/rides/:id/track" element={<TrackingScreen />} />
        <Route path="/messages/:conversationId" element={<ConversationScreen />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
    </MessagingProvider>
  );
}

/**
 * The client-side guard. It hides screens; it does not protect data — that is
 * the server's job on every request. The destination rides along in `next`,
 * so an invitation link opened while signed out still lands on the invitation
 * after signing in.
 */
function SignedInOnly() {
  const state = useCare();
  const location = useLocation();
  if (!isSignedIn(state)) {
    const next = `${location.pathname}${location.search}`;
    const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
    return <Navigate to={`/sign-in${query}`} replace />;
  }
  return <Outlet />;
}

function SignedOutOnly() {
  const state = useCare();
  const location = useLocation();
  if (isSignedIn(state)) return <Navigate to={safeNext(location.search)} replace />;
  return <Outlet />;
}

/** Only ever an in-app path — never an open redirect to another origin. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const tabs = [
  { to: '/', label: 'Home', icon: House, match: (p: string) => p === '/' },
  {
    to: '/appointments',
    label: 'Appointments',
    icon: CalendarDays,
    match: (p: string) => p.startsWith('/appointments'),
  },
  { to: '/notifications', label: 'Updates', icon: Bell, match: (p: string) => p === '/notifications' },
  { to: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

/**
 * Four destinations, always labelled, never icon-only: a stressed adult child
 * on a first visit should not have to remember what a glyph means.
 */
function HomeShell() {
  const state = useCare();
  const unread = unreadNotificationCount(state);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <div className="shell-main">
        <Outlet />
      </div>
      <nav className="nav-bar" aria-label="Main">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                // Tapping the current tab returns to the top of that section.
                if (active && pathname !== tab.to) {
                  e.preventDefault();
                  navigate(tab.to);
                }
              }}
            >
              <span className="nav-icon">
                <Icon size={24} aria-hidden strokeWidth={active ? 2.5 : 2} />
                {tab.to === '/notifications' && unread > 0 && (
                  <span className="badge" aria-label={`${unread} unread`}>
                    {unread}
                  </span>
                )}
              </span>
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function NotFound(): ReactNode {
  const navigate = useNavigate();
  return (
    <Page title="" back>
      <EmptyState
        fill
        icon={Compass}
        title="That page does not exist"
        message="The link may be out of date."
        action={<Button onClick={() => navigate('/')}>Back to home</Button>}
      />
    </Page>
  );
}
