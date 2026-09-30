import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CareApi } from '../src/api/careApi';
import type { components } from '../src/api/schema';
import { InMemoryTokenStore } from '../src/api/tokens';
import { TrackingSocket } from '../src/api/trackingSocket';
import { App } from '../src/App';
import { ConfirmProvider, FeedbackProvider } from '../src/components/feedback';
import { CareStore } from '../src/state/careStore';
import { ServicesProvider } from '../src/state/context';
import { loadSnapshot, Seeded } from './support/fixture';
import { fakeServer, type Handler } from './support/fakeServer';

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
    ...options.routes,
  });
  const tokens = new InMemoryTokenStore();
  if (options.signedIn ?? true) tokens.write({ accessToken: 'a', refreshToken: 'r' });
  const api = new CareApi(tokens, BASE, server.fetchImpl);
  const io = fakeIo();
  const tracking = new TrackingSocket(tokens, BASE, io.connect);
  const store = new CareStore(api);
  await store.restoreSession();

  render(
    <ServicesProvider services={{ store, api, tracking }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <FeedbackProvider>
          <ConfirmProvider>
            <App />
            <LocationProbe />
          </ConfirmProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </ServicesProvider>,
  );
  return { ...server, io, store, tokens };
}

const location = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  // The fixture's appointments are in August 2026; the day before the next one.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-12T12:00:00Z') });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

