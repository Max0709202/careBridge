import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { DriverApi } from '../src/api/driverApi';
import type { components } from '../src/api/schema';
import { InMemoryTokenStore } from '../src/api/tokens';
import { App } from '../src/App';
import { ConfirmProvider, FeedbackProvider } from '../src/components/feedback';
import type { Fix } from '../src/domain/models';
import { LocationService } from '../src/services/locationService';
import type { LocationAccess, PositionSource } from '../src/services/positionSource';
import { StoreProvider } from '../src/state/context';
import { DriverStore } from '../src/state/driverStore';
import { fakeServer, type Handler } from './support/fakeServer';
import { documents, profile, ride } from './support/fixtures';

type S = components['schemas'];
const BASE = 'http://localhost/api/v1';

class StubPositions implements PositionSource {
  constructor(private readonly access: LocationAccess = 'granted') {}
  async ensureAccess() {
    return this.access;
  }
  watch(_onFix: (fix: Fix) => void) {
    return () => undefined;
  }
}

async function renderApp(
  path: string,
  options: {
    signedIn?: boolean;
    rides?: S['DriverRideDto'][];
    access?: LocationAccess;
    routes?: Record<string, Handler>;
  } = {},
) {
  let rides = options.rides ?? [];
  const server = fakeServer({
    'GET /driver/me': () => ({ body: profile() }),
    'GET /driver/rides': () => ({ body: rides }),
    'GET /driver/documents': () => ({ body: documents() }),
    'POST /auth/login': () => ({ body: { accessToken: 'a', refreshToken: 'r' } }),
    'POST /auth/logout': () => ({ status: 204 }),
    ...options.routes,
  });
  const tokens = new InMemoryTokenStore();
  if (options.signedIn ?? true) tokens.write({ accessToken: 'a', refreshToken: 'r' });
  const api = new DriverApi(tokens, BASE, server.fetchImpl);
  const location = new LocationService({
    api,
    positions: new StubPositions(options.access),
    battery: { read: async () => ({ percent: null, charging: false }) },
  });
  const store = new DriverStore(api, location);
  await store.restoreSession();

  render(
    <StoreProvider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <FeedbackProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </StoreProvider>,
  );
  return { ...server, store, tokens, setRides: (next: S['DriverRideDto'][]) => (rides = next) };
}

afterEach(async () => {
  cleanup();
});

describe('signing in', () => {
  it('sends a signed-out driver to sign-in, and on to today', async () => {
    const { requests } = await renderApp('/today', { signedIn: false });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dev@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Dev Patel')).toBeTruthy();
    expect(requests.find((r) => r.path === '/auth/login')?.body).toEqual({ email: 'dev@example.com', password: 'pw' });
  });
});

describe('the shift', () => {
  it('offers to start one, and names the vehicle', async () => {
    const { requests } = await renderApp('/today', {
      routes: { 'PUT /driver/shift': () => ({ body: profile({ onShift: true }) }) },
    });
    expect(await screen.findByText('Silver Toyota Sienna · KXT 4410')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start shift' }));
    expect(await screen.findByRole('button', { name: 'End shift' })).toBeTruthy();
    expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ onShift: true });
  });

  it('says why a suspended driver cannot work', async () => {
    await renderApp('/today', {
      routes: {
        'GET /driver/me': () => ({
          body: profile({ canWork: false, suspensionReason: 'Insurance lapsed' }),
        }),
      },
    });
    expect(await screen.findByText('Suspended: Insurance lapsed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check your paperwork' })).toBeTruthy();
  });

  it('treats "not on a roster" as a sentence, not an error', async () => {
    await renderApp('/today', {
      routes: { 'GET /driver/me': () => ({ status: 404, body: { error: { code: 'not_found_or_forbidden' } } }) },
    });
    expect(await screen.findByText('No driver profile yet')).toBeTruthy();
  });

  it('says an empty list refreshes itself', async () => {
    await renderApp('/today');
    expect(await screen.findByText(/refreshes on its own/)).toBeTruthy();
  });
});

describe('the ride screen', () => {
  it('names the action, puts the passenger first, and offers the call as a button', async () => {
    await renderApp('/job/ride-1', { rides: [ride({ status: 'driverEnRoute', availableTransitions: ['driverArrived'] })] });
    expect(await screen.findByRole('button', { name: 'I have arrived' })).toBeTruthy();
    expect(screen.getByText('Margaret')).toBeTruthy();
    expect(screen.getByText(/400 Parkside Avenue/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Call Margaret' }).getAttribute('href')).toBe('tel:+1-555-0147');
    expect(screen.getByText('Wheelchair')).toBeTruthy();
  });

  it('moves the ride along, keyed against a double tap', async () => {
    const { requests, setRides } = await renderApp('/job/ride-1', {
      rides: [ride({ status: 'driverEnRoute', availableTransitions: ['driverArrived'] })],
      routes: {
        'POST /driver/rides/:id/advance': () => {
          setRides([ride({ status: 'driverArrived' })]);
          return { body: ride({ status: 'driverArrived' }) };
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'I have arrived' }));
    expect(await screen.findByRole('button', { name: 'Passenger is in the car' })).toBeTruthy();
    const advance = requests.find((r) => r.path.endsWith('/advance'))!;
    expect(advance.body).toEqual({ to: 'driverArrived' });
    expect(advance.headers['idempotency-key']).toBeTruthy();
  });

  it('shows a ride that has left the list as done, not broken', async () => {
    await renderApp('/job/ride-gone', { rides: [ride()] });
    expect(await screen.findByText('This ride is done')).toBeTruthy();
  });

  it('sends a driver to site settings when location is blocked', async () => {
    await renderApp('/job/ride-1', { rides: [ride()], access: 'blocked' });
    expect(await screen.findByText(/Location is blocked for this site/)).toBeTruthy();
  });

  it('says it is sharing, and asks for the page to stay open', async () => {
    await renderApp('/job/ride-1', { rides: [ride({ status: 'inProgress', availableTransitions: ['arrivedAtDestination'] })] });
    expect(await screen.findByText('Sharing your location with the family')).toBeTruthy();
    expect(screen.getByText(/Keep this page open/)).toBeTruthy();
  });
});

describe('the no-show', () => {
  it('refuses until the kerbside wait is served, and says so', async () => {
    await renderApp('/job/ride-1', { rides: [ride({ noShowAvailableInSeconds: 120 })] });
    const button = await screen.findByRole('button', { name: /Nobody came out — wait 2:00/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks again before ending the ride', async () => {
    const { requests } = await renderApp('/job/ride-1', {
      rides: [ride({ noShowAvailableInSeconds: 0 })],
      routes: { 'POST /driver/rides/:id/advance': () => ({ body: ride({ status: 'noShow' }) }) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nobody came out' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/tells Margaret’s family/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep waiting' }));
    expect(requests.some((r) => r.path.endsWith('/advance'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Nobody came out' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record no-show' }));
    await waitFor(() => expect(requests.find((r) => r.path.endsWith('/advance'))?.body).toEqual({ to: 'noShow' }));
  });

  it('is not offered before the driver has arrived', async () => {
    await renderApp('/job/ride-1', { rides: [ride({ status: 'driverEnRoute', availableTransitions: ['driverArrived'] })] });
    await screen.findByRole('button', { name: 'I have arrived' });
    expect(screen.queryByRole('button', { name: /Nobody came out/ })).toBeNull();
  });
});

describe('paperwork', () => {
  it('says what is missing and why a document was not accepted', async () => {
    await renderApp('/documents');
    expect(await screen.findByText('Still needed')).toBeTruthy();
    expect(screen.getByText('The expiry date is not readable.')).toBeTruthy();
    expect(screen.getByText('Not accepted')).toBeTruthy();
  });
});

describe('signing out', () => {
  it('clears the session and returns to sign-in', async () => {
    const { tokens } = await renderApp('/today');
    await screen.findByText('Dev Patel');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(tokens.read()).toBeNull();
  });
});
