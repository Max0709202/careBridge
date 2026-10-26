import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CareApi } from '../src/api/careApi';
import type { components } from '../src/api/schema';
import { InMemoryTokenStore } from '../src/api/tokens';
import { TrackingSocket } from '../src/api/trackingSocket';
import { App } from '../src/App';
import { resetServerClock } from '../src/core/serverClock';
import { ConfirmProvider, FeedbackProvider } from '../src/components/feedback';
import { CareStore } from '../src/state/careStore';
import { ServicesProvider } from '../src/state/context';
import { loadSnapshot, Seeded } from './support/fixture';
import { fakeMessaging } from './support/fakeMessaging';
import { fakeServer, type Handler } from './support/fakeServer';

// Leaflet needs a real layout engine. The street map is stood in for by a
// summary of what it was asked to draw.
vi.mock('../src/screens/rides/StreetMap', () => ({
  default: (props: import('../src/screens/rides/StreetMap').StreetMapProps) => (
    <div role="region" aria-label="Street map">
      {props.driver ? (props.isStale ? 'car (stale)' : 'car') : 'no car'} ·{' '}
      {props.route ? `road of ${props.route.length} points` : 'guide line'}
    </div>
  ),
}));

/** Signs in as a person would: the form starts empty. */
function submitSignIn(email = 'ada@example.com', password = 'a-real-password') {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

type Snapshot = components['schemas']['CareStateDto'];

const BASE = 'http://localhost/api/v1';

/** A socket.io stand-in: records emits, lets a test push server events. */
function fakeIo() {
  const handlers = new Map<string, (data: unknown) => void>();
  const emitted: [string, unknown][] = [];
  const socket = {
    connected: true,
    on: (event: string, fn: (data: unknown) => void) => handlers.set(event, fn),
    emit: (event: string, data: unknown) => emitted.push([event, data]),
    disconnect: () => undefined,
  };
  const connect = (() => socket) as unknown as ConstructorParameters<typeof TrackingSocket>[2];
  return { connect, emitted, push: (event: string, data: unknown) => handlers.get(event)?.(data) };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

async function renderApp(
  path: string,
  options: { snapshot?: Snapshot; signedIn?: boolean; routes?: Record<string, Handler> } = {},
) {
  const snapshot = options.snapshot ?? loadSnapshot();
  const server = fakeServer({
    'GET /care/state': () => ({ body: snapshot }),
    'POST /auth/login': () => ({ body: { accessToken: 'a', refreshToken: 'r', state: snapshot } }),
    'POST /auth/logout': () => ({ status: 204 }),
    'GET /conversations': () => ({ body: [] }),
    'GET /calls/targets': () => ({ body: [] }),
    ...options.routes,
  });
  const tokens = new InMemoryTokenStore();
  if (options.signedIn ?? true) tokens.write({ accessToken: 'a', refreshToken: 'r' });
  const api = new CareApi(tokens, BASE, server.fetchImpl);
  const io = fakeIo();
  const tracking = new TrackingSocket(tokens, BASE, io.connect);
  const store = new CareStore(api);
  await store.restoreSession();
  const messaging = fakeMessaging(api);

  render(
    <ServicesProvider services={{ store, api, tracking }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <FeedbackProvider>
          <ConfirmProvider>
            <App messaging={messaging.store} />
            <LocationProbe />
          </ConfirmProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </ServicesProvider>,
  );
  return { ...server, io, store, tokens, messaging };
}

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  // The fixture's appointments are in August 2026; the day before the next one.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-12T12:00:00Z') });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetServerClock();
});

describe('the family web app', () => {
  it('restores a session and leads the dashboard with who, what is next, and the ride', async () => {
    await renderApp('/');
    expect(screen.getByText('Caring for')).toBeTruthy();
    expect(screen.getByText('Eleanor')).toBeTruthy();
    expect(screen.getByText('Next appointment')).toBeTruthy();
    // The outbound ride is waiting for a driver.
    expect(screen.getAllByText('Finding a driver').length).toBeGreaterThan(0);
    expect(screen.getByText(/We are finding a driver/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add appointment' })).toBeTruthy();
    expect(screen.getByText(/in an emergency, call 911/)).toBeTruthy();
  });

  it('lists every ride in progress, each with its own way to follow it', async () => {
    const snapshot = loadSnapshot();
    const first = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    const driver = (id: string, displayName: string) => ({
      id,
      displayName,
      rating: 4.9,
      yearsDriving: 6,
      vehicle: { make: 'Toyota', model: 'Sienna', color: 'Silver', licensePlate: 'ABC 123', isWheelchairAccessible: false },
    });
    first.status = 'driverEnRoute';
    first.driver = driver('driver-1', 'Marcus T.');
    const second = {
      ...structuredClone(first),
      id: '00000000-0000-4000-8000-0000000000aa',
      status: 'passengerOnboard',
      driver: driver('driver-2', 'Priya N.'),
    };
    snapshot.rides.push(second);
    await renderApp('/', { snapshot });

    const marcus = screen.getByLabelText('Current ride for Eleanor with Marcus T.');
    const priya = screen.getByLabelText('Current ride for Eleanor with Priya N.');
    expect(within(marcus).getByRole('button', { name: 'Follow the trip' })).toBeTruthy();
    fireEvent.click(within(priya).getByRole('button', { name: 'Follow the trip' }));
    expect(await screen.findByRole('region', { name: 'Street map' })).toBeTruthy();
  });

  it('keeps a signed-out visitor’s invitation link through sign-in, then accepts it', async () => {
    const { requests } = await renderApp('/accept-invitation?token=inv-123', {
      signedIn: false,
      routes: { 'POST /invitations/accept': () => ({ body: loadSnapshot() }) },
    });
    expect(location()).toBe('/sign-in?next=%2Faccept-invitation%3Ftoken%3Dinv-123');

    submitSignIn();
    await screen.findByText('Join a care circle');
    expect(location()).toBe('/accept-invitation?token=inv-123');

    fireEvent.click(screen.getByRole('button', { name: 'Accept the invitation' }));
    await screen.findByText('You are in');
    expect(requests.find((r) => r.path === '/invitations/accept')?.body).toEqual({ token: 'inv-123' });
  });

  it('asks for the authenticator code when the account has two-factor on', async () => {
    let attempts = 0;
    const { requests } = await renderApp('/sign-in', {
      signedIn: false,
      routes: {
        'POST /auth/login': (req) => {
          attempts += 1;
          const body = req.body as { mfaCode?: string };
          return body.mfaCode === '123456'
            ? { body: { accessToken: 'a', refreshToken: 'r', state: loadSnapshot() } }
            : {
                status: 400,
                body: { error: { code: 'validation', message: 'Enter the code from your authenticator app.', field: 'mfaCode' } },
              };
        },
      },
    });

    submitSignIn();
    const code = await screen.findByLabelText('Authentication code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Caring for');
    expect(attempts).toBe(2);
    expect(requests.filter((r) => r.path === '/auth/login')[1]!.body).toMatchObject({ mfaCode: '123456' });
  });

  it('starts with an empty form — there is no demo account to pre-fill', async () => {
    await renderApp('/sign-in', { signedIn: false });
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('Demo account')).toBeNull();
  });

  it('shows a sign-in failure instead of navigating away', async () => {
    await renderApp('/sign-in', {
      signedIn: false,
      routes: {
        'POST /auth/login': () => ({
          status: 401,
          body: { error: { code: 'authentication', message: 'That email address and password do not match an account.' } },
        }),
      },
    });
    submitSignIn();
    await screen.findByText('That email address and password do not match an account.');
    expect(location()).toBe('/sign-in');
  });

  it('books transport for the appointment day, 40 minutes ahead, with an idempotency key', async () => {
    const { requests } = await renderApp(`/appointments/${Seeded.nextAppointment}/transport`, {
      routes: { 'POST /rides': () => ({ body: loadSnapshot() }) },
    });
    expect(screen.getByText('Arrange transportation')).toBeTruthy();
    // Wheelchair is not among Eleanor's needs; escorting is, so the assistance surcharge shows.
    expect(screen.getByText('Door-through-door assistance')).toBeTruthy();
    expect(screen.getByText('Estimated total (2 legs)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Request round trip' }));
    await screen.findByText('Requested. We are finding a driver.');

    const ride = requests.find((r) => r.method === 'POST' && r.path === '/rides')!;
    expect(ride.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    const body = ride.body as { pickupAt: string; roundTrip: boolean; appointmentId: string };
    expect(body.appointmentId).toBe(Seeded.nextAppointment);
    expect(body.roundTrip).toBe(true);
    expect(new Date(body.pickupAt).getTime()).toBe(new Date('2026-08-13T10:00:00.000Z').getTime());
  });

  it('hides controls a grant does not allow', async () => {
    const snapshot = loadSnapshot();
    const grant = (snapshot.access as Record<string, { permissions: string[] }>)[Seeded.eleanor]!;
    grant.permissions = ['viewProfile'];
    await renderApp('/', { snapshot });
    expect(screen.queryByRole('button', { name: 'Add appointment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request transport' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
  });

  it('shows the same screen for a person you may not see as for one that does not exist', async () => {
    const snapshot = loadSnapshot();
    delete (snapshot.access as Record<string, unknown>)[Seeded.frank];
    await renderApp(`/patients/${Seeded.frank}`, { snapshot });
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getByText('We could not find that, or you do not have access to it.')).toBeTruthy();
  });

  it('warns in words when the live position is going stale, and prefers the newer reading', async () => {
    const snapshot = loadSnapshot();
    const ride = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    ride.status = 'driverEnRoute';
    ride.etaMinutes = 9;
    ride.lastKnownPosition = {
      latitude: 39.96,
      longitude: -83.0,
      accuracyMeters: 10,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const { io } = await renderApp(`/rides/${Seeded.outboundRide}/track`, { snapshot });

    expect(screen.getByText('Position last updated 1 minute ago. It may be out of date.')).toBeTruthy();
    expect(screen.getByText('Driver is about 9 minutes away')).toBeTruthy();
    expect(io.emitted).toContainEqual(['watch', { rideId: Seeded.outboundRide }]);

    // A fresh reading pushed over the socket replaces the stale one.
    act(() =>
      io.push('position', {
        rideId: Seeded.outboundRide,
        latitude: 39.97,
        longitude: -83.0,
        capturedAt: new Date(Date.now() - 2_000).toISOString(),
        etaMinutes: 4,
      }),
    );
    await screen.findByText('Position updated just now.');
    expect(screen.getByText('Driver is about 4 minutes away')).toBeTruthy();
  });

  it('draws the road the car is following on the street map', async () => {
    const snapshot = loadSnapshot();
    const ride = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    ride.status = 'driverEnRoute';
    ride.lastKnownPosition = {
      latitude: 39.96,
      longitude: -83.0,
      accuracyMeters: 10,
      capturedAt: new Date(Date.now() - 5_000).toISOString(),
    };
    ride.route = {
      target: 'pickup',
      path: [
        { latitude: 39.96, longitude: -83.0 },
        { latitude: 39.965, longitude: -82.99 },
        { latitude: 39.97, longitude: -82.98 },
      ],
    };
    await renderApp(`/rides/${Seeded.outboundRide}/track`, { snapshot });
    expect((await screen.findByRole('region', { name: 'Street map' })).textContent).toBe('car · road of 3 points');
  });

  it('ages a position by the server clock, so a computer an hour fast does not show the car as lost', async () => {
    // This device's clock is an hour ahead of the server's. The reading is
    // five seconds old by the server — the clock that judged it.
    const serverNowMs = Date.now() - 3_600_000;
    const snapshot = loadSnapshot();
    const ride = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    ride.status = 'driverEnRoute';
    ride.lastKnownPosition = {
      latitude: 39.96,
      longitude: -83.0,
      accuracyMeters: 10,
      capturedAt: new Date(serverNowMs - 5_000).toISOString(),
    };
    await renderApp(`/rides/${Seeded.outboundRide}/track`, {
      snapshot,
      routes: {
        'GET /care/state': () => ({ body: snapshot, headers: { date: new Date(serverNowMs).toUTCString() } }),
      },
    });

    expect(await screen.findByText(/Position updated (just now|\d+ seconds ago)\./)).toBeTruthy();
    expect(screen.queryByText(/lost contact/)).toBeNull();
  });

  it('keeps a backup poll running only while the trip is on screen', async () => {
    const released = vi.fn();
    const watch = vi.spyOn(CareStore.prototype, 'watchLiveTrip').mockReturnValue(released);
    const snapshot = loadSnapshot();
    snapshot.rides.find((r) => r.id === Seeded.outboundRide)!.status = 'driverEnRoute';
    await renderApp(`/rides/${Seeded.outboundRide}/track`, { snapshot });
    await screen.findByRole('region', { name: 'Street map' });

    expect(watch).toHaveBeenCalled();
    expect(released).not.toHaveBeenCalled();
    cleanup();
    expect(released).toHaveBeenCalled();
    watch.mockRestore();
  });

  it('shows neither car nor road once contact is lost', async () => {
    const snapshot = loadSnapshot();
    const ride = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    ride.status = 'driverEnRoute';
    ride.lastKnownPosition = {
      latitude: 39.96,
      longitude: -83.0,
      accuracyMeters: 10,
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    ride.route = {
      target: 'pickup',
      path: [
        { latitude: 39.96, longitude: -83.0 },
        { latitude: 39.97, longitude: -82.98 },
      ],
    };
    await renderApp(`/rides/${Seeded.outboundRide}/track`, { snapshot });
    expect((await screen.findByRole('region', { name: 'Street map' })).textContent).toBe('no car · guide line');
  });

  it('stops presenting a position once the ride has ended', async () => {
    await renderApp(`/rides/00000000-0000-4000-8000-000000000062/track`);
    expect(screen.getByText('This trip is complete')).toBeTruthy();
  });

  it('marks all updates read and clears the badge', async () => {
    const snapshot = loadSnapshot();
    snapshot.notifications[0]!.readAt = null;
    const read = loadSnapshot();
    await renderApp('/notifications', { snapshot, routes: { 'POST /notifications/read-all': () => ({ body: read }) } });
    expect(screen.getByLabelText('1 unread')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).toBeNull());
  });

  it('confirms before signing out, then lands on sign-in', async () => {
    const { tokens } = await renderApp('/settings');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Sign out?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(location()).toBe('/sign-in'));
    expect(tokens.read()).toBeNull();
  });

  it('turns simplified mode on for the whole document', async () => {
    const on = loadSnapshot();
    on.simplifiedMode = true;
    await renderApp('/settings', { routes: { 'PATCH /me/preferences': () => ({ body: on }) } });
    fireEvent.click(screen.getByRole('switch', { name: 'Simplified mode' }));
    await waitFor(() => expect(document.documentElement.classList.contains('simplified')).toBe(true));
  });

  it('has a page for a link that goes nowhere', async () => {
    await renderApp('/no/such/place');
    expect(screen.getByText('That page does not exist')).toBeTruthy();
  });
});


// ─── messaging and calls ────────────────────────────────────────────────────

function familyConversation(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    kind: 'dispatchFamily',
    organizationId: 'org-1',
    organizationName: 'Meridian Transit',
    patientId: Seeded.eleanor,
    driverId: null,
    peerDriverId: null,
    rideId: '00000000-0000-4000-8000-000000000062',
    title: 'Meridian Transit dispatch',
    myRole: 'family',
    canPost: true,
    ride: {
      id: '00000000-0000-4000-8000-000000000062',
      status: 'completed',
      direction: 'outbound',
      scheduledPickupAt: '2026-08-10T13:00:00Z',
      patientName: 'Eleanor',
    },
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
    ...over,
  };
}

describe('messaging dispatch and calling through the relay', () => {
  it('opens the ride\'s own thread with dispatch from the ride', async () => {
    const { requests } = await renderApp('/rides/00000000-0000-4000-8000-000000000062', {
      routes: {
        'POST /conversations': () => ({ body: familyConversation() }),
        'GET /conversations/:id/messages': () => ({ body: { messages: [], hasMore: false } }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Message dispatch' }));
    expect(await screen.findByRole('heading', { name: 'Meridian Transit dispatch' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain("Eleanor's ride");
    expect(location()).toBe('/messages/c-1');
    expect(requests.find((r) => r.method === 'POST' && r.path === '/conversations')?.body).toEqual({
      kind: 'dispatchFamily',
      rideId: '00000000-0000-4000-8000-000000000062',
    });
  });

  it('calls the driver through the relay from the tracking screen, never showing a number', async () => {
    const snapshot = loadSnapshot();
    const finished = snapshot.rides.find((r) => r.id === '00000000-0000-4000-8000-000000000062')!;
    const ride = snapshot.rides.find((r) => r.id === Seeded.outboundRide)!;
    ride.status = 'driverEnRoute';
    ride.driver = finished.driver;
    const { requests } = await renderApp(`/rides/${Seeded.outboundRide}/track`, {
      snapshot,
      routes: {
        'GET /calls/targets': () => ({
          body: [
            { kind: 'dispatch', id: 'org-1', label: 'Meridian Transit dispatch', available: true, unavailableReason: null },
            { kind: 'driver', id: 'd-1', label: 'Marcus T.', available: true, unavailableReason: null },
          ],
        }),
        'POST /calls': () => ({
          status: 201,
          body: {
            id: 'call-1',
            status: 'initiating',
            calleeKind: 'driver',
            calleeLabel: 'Marcus T.',
            conversationId: null,
            rideId: Seeded.outboundRide,
            startedAt: '2026-08-12T12:00:00Z',
            answeredAt: null,
            endedAt: null,
            durationSeconds: null,
          },
        }),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Call Marcus T.' }));
    expect(await screen.findByText(/Your phone is ringing/)).toBeTruthy();
    expect(requests.find((r) => r.path === '/calls')?.body).toEqual({
      rideId: Seeded.outboundRide,
      callee: { kind: 'driver', id: 'd-1' },
    });
  });

  it('lists conversations with dispatch in Updates, with unread counts', async () => {
    await renderApp('/notifications', {
      routes: {
        'GET /conversations': () => ({
          body: [familyConversation({ lastMessageAt: '2026-08-12T11:00:00Z', unreadCount: 2 })],
        }),
        'GET /conversations/:id/messages': () => ({ body: { messages: [], hasMore: false } }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /2 unread\. Meridian Transit dispatch/ }));
    expect(location()).toBe('/messages/c-1');
  });

  it('opens the thread a message notification is about', async () => {
    const snapshot = loadSnapshot();
    Object.assign(snapshot.notifications[0]!, {
      kind: 'messageReceived',
      title: 'New message',
      body: 'Dispatch sent you a message. Open CareBridge to read it.',
      conversationId: 'c-1',
      rideId: '00000000-0000-4000-8000-000000000062',
    });
    await renderApp('/notifications', {
      snapshot,
      routes: {
        'GET /conversations/:id': () => ({ body: familyConversation() }),
        'GET /conversations/:id/messages': () => ({ body: { messages: [], hasMore: false } }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /New message/ }));
    expect(location()).toBe('/messages/c-1');
  });

  it('saves the number your phone rings on for relay calls', async () => {
    const { requests } = await renderApp('/settings/calls', {
      routes: {
        'GET /calls/my-number': () => ({ body: { phone: null } }),
        'PUT /calls/my-number': () => ({ body: { phone: '+16145550199' } }),
      },
    });
    const field = await screen.findByLabelText('Your phone number');
    await waitFor(() => expect((field as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(field, { target: { value: '(614) 555-0199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save number' }));
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('+16145550199'));
    expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ phone: '(614) 555-0199' });
  });
});
