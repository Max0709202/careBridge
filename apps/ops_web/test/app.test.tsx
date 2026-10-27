/**
 * Whole-app flows against a fake API. Ports of the behaviours in
 * apps/ops_console/test/*_screen_test.dart, plus the routing rules.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpsApi } from '../src/api/opsApi';
import { InMemoryTokenStore } from '../src/api/tokens';
import { App } from '../src/App';
import { ConfirmProvider, FeedbackProvider } from '../src/components/feedback';
import { StoreProvider } from '../src/state/context';
import { OpsStore } from '../src/state/opsStore';
import { fakeServer, type Handler } from './support/fakeServer';
import { fakeMessaging } from './support/fakeMessaging';
import {
  account,
  auditEntry,
  candidate,
  driver,
  flag,
  invoice,
  liveBoard,
  liveRide,
  organization,
  plan,
  queue,
  queueItem,
  refundable,
  stats,
  subscription,
} from './support/fixtures';

const BASE = 'http://localhost/api/v1';

// Leaflet needs a real layout engine. The map is stood in for by a list of what
// it was asked to draw, and a button that plays the part of a click on it.
vi.mock('../src/components/LiveMap', () => ({
  LiveMap: (props: import('../src/components/LiveMap').LiveMapProps) => (
    <div aria-label="Live map">
      <span>area: {props.area ? props.area.kind : 'none'}</span>
      {props.onPickPoint && (
        <button
          type="button"
          onClick={() => props.onPickPoint?.({ latitude: 40.7, longitude: -73.9 })}
        >
          Click the map
        </button>
      )}
    </div>
  ),
}));

async function renderApp(
  path: string,
  options: {
    signedIn?: boolean;
    organizationId?: string | null;
    routes?: Record<string, Handler>;
  } = {},
) {
  const server = fakeServer({
    'POST /auth/login': () => ({ body: { accessToken: 'a', refreshToken: 'r' } }),
    'POST /auth/logout': () => ({ status: 204 }),
    'GET /organizations': () => ({ body: [organization()] }),
    'GET /organizations/:id/dispatch/queue': () => ({ body: queue() }),
    'GET /organizations/:id/drivers': () => ({ body: [driver()] }),
    'GET /organizations/:id/vehicles': () => ({ body: [driver().vehicle] }),
    'GET /organizations/:id/billing': () => ({ body: account() }),
    'GET /organizations/:id/billing/invoices': () => ({ body: [invoice()] }),
    'GET /billing/plans': () => ({ body: [plan()] }),
    'GET /conversations': () => ({ body: [] }),
    ...options.routes,
  });
  const tokens = new InMemoryTokenStore();
  if (options.signedIn ?? true) tokens.write({ accessToken: 'a', refreshToken: 'r' });
  const organizationId =
    options.organizationId === undefined ? 'org-1' : options.organizationId;
  if (organizationId)
    window.sessionStorage.setItem('carebridge.ops.organizationId', organizationId);

  const api = new OpsApi(tokens, BASE, server.fetchImpl);
  const store = new OpsStore(api, window.sessionStorage);
  store.restoreSession();
  const messaging = fakeMessaging(api);

  render(
    <StoreProvider store={store}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <FeedbackProvider>
          <ConfirmProvider>
            <App messaging={messaging.store} />
          </ConfirmProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </StoreProvider>,
  );
  return { ...server, store, tokens, messaging };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('signing in and choosing an operator', () => {
  it('sends a signed-out dispatcher to sign-in, then to a choice, never a default', async () => {
    const { requests } = await renderApp('/queue', {
      signedIn: false,
      organizationId: null,
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'dispatch@example.com ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Even with one operator, the picker asks.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Meridian Transit, owner' }),
    );
    expect(await screen.findByRole('heading', { name: 'Queue' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Meridian Transit' })).toBeTruthy();
    expect(requests.find((r) => r.path === '/auth/login')?.body).toEqual({
      email: 'dispatch@example.com',
      password: 'pw',
    });
  });

  it('asks for a two-factor code only after the server does', async () => {
    await renderApp('/sign-in', {
      signedIn: false,
      routes: {
        'POST /auth/login': () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              field: 'mfaCode',
              message: 'Enter your code.',
            },
          },
        }),
      },
    });
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Authentication code')).toBeTruthy();
  });

  it('says plainly that a member role cannot dispatch', async () => {
    await renderApp('/organizations', {
      organizationId: null,
      routes: {
        'GET /organizations': () => ({ body: [organization({ role: 'member' })] }),
      },
    });
    expect(
      await screen.findByText('This role cannot use the dispatch console.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Meridian Transit/ })).toBeNull();
  });

  it('gives a platform account with no membership somewhere to go', async () => {
    await renderApp('/organizations', {
      organizationId: null,
      routes: {
        'GET /organizations': () => ({ body: [] }),
        'GET /admin/stats': () => ({ body: stats() }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open administration' }));
    expect(
      await screen.findByRole('heading', { name: 'CareBridge administration' }),
    ).toBeTruthy();
  });

  it('keeps the operator across a reload, and drops it when the membership is gone', async () => {
    await renderApp('/queue', {
      organizationId: 'org-gone',
      routes: { 'GET /organizations': () => ({ body: [organization()] }) },
    });
    expect(
      await screen.findByRole('heading', { name: 'Choose an operator' }),
    ).toBeTruthy();
    expect(window.sessionStorage.getItem('carebridge.ops.organizationId')).toBeNull();
  });

  it('switching operator actually reaches the picker', async () => {
    await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch operator' }));
    expect(
      await screen.findByRole('heading', { name: 'Choose an operator' }),
    ).toBeTruthy();
  });
});

describe('the queue', () => {
  it('an empty queue says so rather than showing a blank panel', async () => {
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({ body: queue([], 3) }),
      },
    });
    expect(await screen.findByText('Nothing waiting')).toBeTruthy();
    expect(screen.getByText(/3 drivers free right now/)).toBeTruthy();
  });

  it('a ride nobody can take says so, and says why, with the remedy', async () => {
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([
            queueItem({
              candidates: [
                candidate({ eligible: false, reasons: ['offShift'] }),
                candidate({
                  driverId: 'd2',
                  eligible: false,
                  reasons: ['offShift', 'noAccessibleVehicle'],
                }),
              ],
            }),
          ]),
        }),
      },
    });
    expect(await screen.findByText('Nobody available for this trip')).toBeTruthy();
    expect(
      screen.getByText('2 × Not on shift — Put them on shift from the roster'),
    ).toBeTruthy();
    expect(screen.getByText('1 × No wheelchair-accessible vehicle')).toBeTruthy();
    expect(screen.getByText(/needs a call, not a tap/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull();
  });

  it('urgency is never colour alone, and a wheelchair is on the row', async () => {
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([queueItem({ urgency: 'overdue', wheelchairRequired: true })]),
        }),
      },
    });
    expect(await screen.findByRole('img', { name: 'Urgency: Overdue' })).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByLabelText('Needs a wheelchair-accessible vehicle')).toBeTruthy();
    expect(screen.getByText('1 past their pickup time')).toBeTruthy();
  });

  it('assigns, keyed against a double click, and refreshes the queue and roster', async () => {
    const { requests } = await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([
            queueItem({
              candidates: [
                candidate({
                  driverId: 'd-busy',
                  displayName: 'Anna B.',
                  eligible: false,
                  reasons: ['alreadyOnARide'],
                }),
                candidate(),
              ],
            }),
          ]),
        }),
        'POST /organizations/:id/dispatch/rides/:ride/assign': () => ({
          body: queue([]),
        }),
      },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Assign (1 available)' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Assign a driver' });
    // Ineligible candidates are listed, not hidden — and cannot be chosen.
    const busy = within(sheet).getByRole('radio', { name: /Anna B\./ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText('Already on a trip')).toBeTruthy();

    const confirm = within(sheet).getByRole('button', {
      name: 'Confirm',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: /Marcus T\./ }));
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const assign = requests.find((r) => r.path.endsWith('/assign'))!;
    expect(assign.path).toBe('/organizations/org-1/dispatch/rides/ride-1/assign');
    expect(assign.body).toEqual({ driverId: 'driver-1' });
    expect(assign.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() =>
      expect(requests.filter((r) => r.path.endsWith('/dispatch/queue')).length).toBe(2),
    );
  });

  it('a reassignment will not go until it says why', async () => {
    const { requests } = await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([queueItem({ status: 'reassignmentRequired' })]),
        }),
        'POST /organizations/:id/dispatch/rides/:ride/assign': () => ({
          body: queue([]),
        }),
      },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reassign (1 available)' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Reassign this trip' });
    fireEvent.click(within(sheet).getByRole('radio', { name: /Marcus T\./ }));
    const confirm = within(sheet).getByRole('button', {
      name: 'Confirm',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Why is this being reassigned?'), {
      target: { value: 'Flat tyre' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/assign'))?.body).toEqual({
        driverId: 'driver-1',
        reason: 'Flat tyre',
      }),
    );
  });

  it('a failure offers a retry rather than a stack trace', async () => {
    let fail = true;
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () =>
          fail
            ? { status: 500, body: { error: { code: 'internal' } } }
            : { body: queue([], 0) },
      },
    });
    expect(await screen.findByText('Could not load the queue')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nothing waiting')).toBeTruthy();
  });
});

describe('the roster', () => {
  it('a dispatcher can change a shift but not a standing', async () => {
    const { requests } = await renderApp('/roster', {
      routes: {
        'GET /organizations': () => ({ body: [organization({ role: 'dispatcher' })] }),
        'PUT /organizations/:id/drivers/:d/shift': () => ({
          body: driver({ onShift: false }),
        }),
      },
    });
    const shift = await screen.findByRole('switch', { name: 'On shift' });
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paperwork' })).toBeNull();
    fireEvent.click(shift);
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({
        onShift: false,
      }),
    );
  });

  it('adds an existing account by its exact address, as pending approval', async () => {
    const match = {
      userId: 'user-9',
      fullName: 'Kenji Sato',
      email: 'kenji@example.com',
      suggestedDisplayName: 'Kenji S.',
    };
    const { requests } = await renderApp('/roster', {
      routes: {
        'POST /organizations/:id/drivers/account-lookup': (r) =>
          (r.body as { email: string }).email === 'kenji@example.com'
            ? { body: match }
            : {
                status: 400,
                body: {
                  error: {
                    code: 'validation',
                    message: 'No account at that address can be added.',
                    field: 'email',
                  },
                },
              },
        'POST /organizations/:id/drivers': () => ({
          body: driver({
            id: 'd-9',
            displayName: 'Kenji S.',
            status: 'pendingApproval',
          }),
        }),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add driver' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a driver' });

    // Nobody it can add is said under the field, with the server's words.
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find account' }));
    expect(
      await within(dialog).findByText('No account at that address can be added.'),
    ).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: 'kenji@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find account' }));
    expect(await within(dialog).findByText('Kenji Sato')).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('Name on the roster') as HTMLInputElement).value,
    ).toBe('Kenji S.');

    // A vehicle is required before it will go.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add driver' }));
    expect(
      await within(dialog).findByText('Choose the vehicle they will drive'),
    ).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Vehicle'), {
      target: { value: driver().vehicle.id },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add driver' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add a driver' })).toBeNull(),
    );

    const created = requests.find(
      (r) => r.method === 'POST' && r.path.endsWith('/drivers'),
    );
    expect(created?.body).toEqual({
      displayName: 'Kenji S.',
      vehicleId: driver().vehicle.id,
      userId: 'user-9',
    });
    expect(created?.headers['idempotency-key']).toBeTruthy();
  });

  it('only owners and admins are offered Add driver', async () => {
    await renderApp('/roster', {
      routes: {
        'GET /organizations': () => ({ body: [organization({ role: 'dispatcher' })] }),
      },
    });
    await screen.findByRole('switch', { name: 'On shift' });
    expect(screen.queryByRole('button', { name: 'Add driver' })).toBeNull();
  });

  it('suspending asks why, and will not go without an answer', async () => {
    const { requests } = await renderApp('/roster', {
      routes: {
        'POST /organizations/:id/drivers/:d/status': () => ({
          body: driver({ status: 'suspended' }),
        }),
      },
    });
    expect(await screen.findByText('Occupies a billable seat')).toBeTruthy();
    // Approved drivers can be suspended or offboarded — never re-approved.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Why suspended?' });
    const confirm = within(dialog).getByRole('button', {
      name: 'Confirm',
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'Insurance lapsed' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/status'))?.body).toEqual({
        to: 'suspended',
        reason: 'Insurance lapsed',
      }),
    );
  });

  it('paperwork says what is missing, and a rejection needs a reason', async () => {
    await renderApp('/roster', {
      routes: {
        'GET /organizations/:id/drivers': () => ({
          body: [driver({ status: 'pendingApproval', occupiesSeat: false })],
        }),
        'GET /organizations/:id/drivers/:d/documents': () => ({
          body: {
            compliant: false,
            missing: ['vehicleInsurance'],
            expiringSoon: [],
            documents: [
              {
                id: 'doc-1',
                kind: 'driversLicence',
                status: 'submitted',
                contentType: 'image/jpeg',
                byteSize: 10,
                expiresAt: null,
                submittedAt: '2026-06-01T00:00:00Z',
                reviewedAt: null,
                reviewNote: null,
                superseded: false,
              },
            ],
          },
        }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Paperwork' }));
    const sheet = await screen.findByRole('dialog', { name: 'Marcus T. — paperwork' });
    expect(
      await within(sheet).findByText(/still missing: Vehicle insurance/),
    ).toBeTruthy();
    expect(
      (within(sheet).getByRole('button', { name: 'Reject' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Reason, if rejecting'), {
      target: { value: 'Blurred' },
    });
    expect(
      (within(sheet).getByRole('button', { name: 'Reject' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe('billing', () => {
  it('an operator with no plan is told what happens instead, and offered the ladder', async () => {
    await renderApp('/billing', {
      routes: {
        'GET /organizations/:id/billing': () => ({
          body: account({ subscription: null }),
        }),
      },
    });
    expect(await screen.findByText(/takes a margin on each fare instead/)).toBeTruthy();
    expect(await screen.findByText('Up to 25 drivers: $15.00 each')).toBeTruthy();
    expect(screen.getByText('Beyond that: $12.00 per driver')).toBeTruthy();
    expect(screen.getByText(/14-day free trial/)).toBeTruthy();
  });

  it('a subscription with no card behind it says so', async () => {
    await renderApp('/billing', {
      routes: {
        'GET /organizations/:id/billing': () => ({
          body: account({ paymentMethod: null }),
        }),
      },
    });
    expect(await screen.findByText(/will bill a card that is not there/)).toBeTruthy();
  });

  it('the renewal is itemised rather than asserted', async () => {
    await renderApp('/billing');
    expect(await screen.findByText('Drivers above 10 × 2')).toBeTruthy();
    expect(screen.getAllByText('$279.00').length).toBeGreaterThan(0);
  });

  it('a failed payment says the console is still working', async () => {
    await renderApp('/billing', {
      routes: {
        'GET /organizations/:id/billing': () => ({
          body: account({ subscription: subscription({ status: 'pastDue' }) }),
        }),
      },
    });
    expect(
      await screen.findByText(/keeps working for the plan’s grace window/),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Subscription: Payment failed' }),
    ).toBeTruthy();
  });

  it('switching interval explains that money moves today, and waits for a yes', async () => {
    const { requests } = await renderApp('/billing', {
      routes: {
        'POST /organizations/:id/billing/change-interval': () => ({ body: account() }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to yearly' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Switch to yearly billing',
    });
    expect(
      within(dialog).getByText(/credited and a fresh period starts today/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch' }));
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/change-interval'))?.body).toEqual({
        interval: 'annual',
      }),
    );
  });

  it('an invoice in dunning offers a way to pay it now', async () => {
    await renderApp('/billing', {
      routes: {
        'GET /organizations/:id/billing/invoices': () => ({
          body: [
            invoice({
              status: 'open',
              attemptCount: 2,
              paidAt: null,
              nextAttemptAt: null,
            }),
          ],
        }),
      },
    });
    expect(
      await screen.findByText(
        /Payment failed 2 time\(s\)\. No further attempt is scheduled\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeTruthy();
  });

  it('a card number is never asked for', async () => {
    await renderApp('/billing');
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the card' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a card' });
    expect(within(dialog).getByLabelText('Processor token')).toBeTruthy();
    expect(within(dialog).queryByLabelText(/card number/i)).toBeNull();
  });
});

describe('administration', () => {
  const admin = {
    'GET /admin/stats': () => ({ body: stats({ staleTrackingNow: 2 }) }),
  };

  it('is a door only for an account the server answered a platform read for', async () => {
    await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    expect(screen.queryByRole('button', { name: 'Administration' })).toBeNull();
    cleanup();
    await renderApp('/queue', { routes: admin });
    fireEvent.click(await screen.findByRole('button', { name: 'Administration' }));
    expect(
      await screen.findByRole('heading', { name: 'CareBridge administration' }),
    ).toBeTruthy();
  });

  it('a stale trip is presented as a telephone call', async () => {
    await renderApp('/admin', { routes: admin });
    expect(
      await screen.findByText(
        '2 trip(s) in flight have not reported a position recently',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Telephone the driver/)).toBeTruthy();
  });

  it('a week where nothing finished is not reported as 0%', async () => {
    await renderApp('/admin', {
      routes: {
        'GET /admin/stats': () => ({ body: stats({ ridesCompletedLast7Days: 0 }) }),
      },
    });
    expect(
      await screen.findByText('Nothing is waiting on a person right now.'),
    ).toBeTruthy();
    expect(
      screen.getByText('No trips have reached an end state in the last seven days.'),
    ).toBeTruthy();
  });

  it('the audit log pages by cursor and shows names, never values', async () => {
    const { requests } = await renderApp('/admin/audit', {
      routes: {
        'GET /admin/audit': (r) =>
          r.path.includes('cursor=')
            ? {
                body: {
                  entries: [auditEntry({ id: 'a2', action: 'ride.assigned' })],
                  nextCursor: null,
                },
              }
            : { body: { entries: [auditEntry()], nextCursor: 'c1' } },
      },
    });
    expect(await screen.findByText('Priya — driver.approved')).toBeTruthy();
    expect(screen.getByText('Fields changed: status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Priya — ride.assigned')).toBeTruthy();
    expect(screen.getByText('End of the log for this filter.')).toBeTruthy();
    expect(requests.map((r) => r.path)).toContain('/admin/audit?cursor=c1');

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'driver.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(requests.map((r) => r.path)).toContain('/admin/audit?action=driver.'),
    );
  });

  it('narrowing a flag asks first, and says so on the wire only when it asked', async () => {
    const { requests } = await renderApp('/admin/flags', {
      routes: {
        'GET /admin/flags': () => ({ body: [flag()] }),
        'PUT /admin/flags/:key': () => ({ body: [flag({ rolloutPercent: 10 })] }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit marketplace' }));
    const dialog = await screen.findByRole('dialog', { name: 'marketplace' });
    fireEvent.change(within(dialog).getByLabelText('Rollout: 50%'), {
      target: { value: '10' },
    });
    expect(within(dialog).getByText(/You will be asked to confirm/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'This takes the feature away',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Take it away' }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({
        description: 'Lets families pick from several operators.',
        enabled: true,
        rolloutPercent: 10,
        confirmNarrowing: true,
      }),
    );
  });

  it('a refund cannot exceed what is left, and carries the payment it was looking at', async () => {
    const { requests } = await renderApp('/admin/refunds', {
      routes: {
        'GET /admin/invoices/:id/refunds': () => ({
          body: refundable({ refundableCents: 5000 }),
        }),
        'POST /admin/invoices/:id/refunds': () => ({
          body: refundable({ refundableCents: 2550 }),
        }),
      },
    });
    fireEvent.change(screen.getByLabelText('Invoice id'), {
      target: { value: 'inv-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Refund invoice CB-0001',
    });
    const amount = within(dialog).getByLabelText('Amount') as HTMLInputElement;
    expect(amount.value).toBe('50.00');
    fireEvent.change(amount, { target: { value: '60' } });
    fireEvent.change(within(dialog).getByLabelText('Why'), {
      target: { value: 'Charged twice' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Send the money back' }),
    );
    expect(
      await within(dialog).findByText('Only $50.00 is left on this payment.'),
    ).toBeTruthy();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);

    fireEvent.change(amount, { target: { value: '24.50' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Send the money back' }),
    );
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'POST')?.body).toEqual({
        paymentId: 'pay-1',
        amountCents: 2450,
        reason: 'Charged twice',
      }),
    );
    expect(await screen.findByText('$25.50')).toBeTruthy();
  });
});

describe('signing out', () => {
  it('clears the session and the chosen operator', async () => {
    const { tokens } = await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(tokens.read()).toBeNull();
    expect(window.sessionStorage.getItem('carebridge.ops.organizationId')).toBeNull();
  });
});

// ─── messaging ──────────────────────────────────────────────────────────────

function conversationWire(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    kind: 'dispatchFamily',
    organizationId: 'org-1',
    organizationName: 'Meridian Transit',
    patientId: 'p-1',
    driverId: null,
    peerDriverId: null,
    rideId: 'ride-1',
    title: 'Eleanor · family',
    myRole: 'dispatcher',
    canPost: true,
    ride: {
      id: 'ride-1',
      status: 'awaitingAssignment',
      direction: 'outbound',
      scheduledPickupAt: '2026-10-01T09:30:00Z',
      patientName: 'Eleanor',
    },
    lastMessage: null,
    lastMessageAt: '2026-10-01T09:00:00Z',
    unreadCount: 0,
    ...over,
  };
}

function messageWire(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: 'c-1',
    senderRole: 'family',
    senderLabel: 'Sarah (daughter)',
    body: 'She will wait inside.',
    createdAt: '2026-10-01T09:00:00Z',
    clientMessageId: 'family-1',
    mine: false,
    ...over,
  };
}

describe('messages', () => {
  it('badges unread conversations for this operator only', async () => {
    await renderApp('/queue', {
      routes: {
        'GET /conversations': () => ({
          body: [
            conversationWire({ unreadCount: 2 }),
            conversationWire({
              id: 'c-2',
              organizationId: 'org-other',
              unreadCount: 5,
            }),
          ],
        }),
      },
    });
    expect(
      await screen.findByRole('link', { name: 'Messages, 2 unread' }),
    ).toBeTruthy();
  });

  it('shows a thread with the trip it is about, and sends with a reusable client id', async () => {
    const { requests } = await renderApp('/messages/c-1', {
      routes: {
        'GET /conversations': () => ({ body: [conversationWire({ unreadCount: 1 })] }),
        'GET /conversations/:id/messages': () => ({
          body: { messages: [messageWire()], hasMore: false },
        }),
        'POST /conversations/:id/read': () => ({ status: 204 }),
        'GET /calls/targets': () => ({ body: [] }),
        'POST /conversations/:id/messages': (r) => ({
          status: 201,
          body: messageWire({
            id: 'm-2',
            senderRole: 'dispatcher',
            senderLabel: 'Dana · Dispatch',
            body: (r.body as { body: string }).body,
            clientMessageId: (r.body as { clientMessageId: string }).clientMessageId,
            mine: true,
          }),
        }),
      },
    });

    expect(await screen.findByText('She will wait inside.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Eleanor');
    await waitFor(() =>
      expect(requests.some((r) => r.path === '/conversations/c-1/read')).toBe(true),
    );

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Driver is ten minutes away' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Driver is ten minutes away')).toBeTruthy();
    const sent = requests.find(
      (r) => r.method === 'POST' && r.path === '/conversations/c-1/messages',
    )!;
    const { clientMessageId } = sent.body as { clientMessageId: string };
    // The retry key and the message's own id are one and the same.
    expect(sent.headers['idempotency-key']).toBe(clientMessageId);
  });

  it('keeps a failed message on screen with a retry that reuses its id', async () => {
    let attempts = 0;
    const { requests } = await renderApp('/messages/c-1', {
      routes: {
        'GET /conversations': () => ({ body: [conversationWire()] }),
        'GET /conversations/:id/messages': () => ({
          body: { messages: [], hasMore: false },
        }),
        'GET /calls/targets': () => ({ body: [] }),
        'POST /conversations/:id/messages': (r) => {
          attempts += 1;
          return attempts === 1
            ? { status: 500, body: { error: { code: 'internal', message: 'boom' } } }
            : {
                status: 201,
                body: messageWire({ id: 'm-9', mine: true, ...(r.body as object) }),
              };
        },
      },
    });

    fireEvent.change(await screen.findByLabelText('Message'), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: /Not sent — retry/ }));

    await waitFor(() => expect(attempts).toBe(2));
    const ids = requests
      .filter((r) => r.method === 'POST' && r.path === '/conversations/c-1/messages')
      .map((r) => (r.body as { clientMessageId: string }).clientMessageId);
    expect(new Set(ids).size).toBe(1);
  });

  it('appends a message pushed over the socket, and counts it unread elsewhere', async () => {
    const { messaging } = await renderApp('/queue', {
      routes: { 'GET /conversations': () => ({ body: [conversationWire()] }) },
    });
    await screen.findByRole('link', { name: 'Messages' });

    act(() => {
      messaging.socket.push({
        type: 'message',
        conversationId: 'c-1',
        rideId: 'ride-1',
        message: {
          id: 'm-5',
          conversationId: 'c-1',
          senderRole: 'family',
          senderLabel: 'Sarah (daughter)',
          body: 'Running late',
          createdAt: new Date('2026-10-01T09:05:00Z'),
          clientMessageId: 'f-5',
          mine: false,
        },
      });
    });

    expect(
      await screen.findByRole('link', { name: 'Messages, 1 unread' }),
    ).toBeTruthy();
  });

  it('opens the family thread for a queued trip', async () => {
    const { requests } = await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([queueItem({ candidates: [candidate()] })]),
        }),
        'POST /conversations': () => ({
          body: conversationWire({ lastMessageAt: null }),
        }),
        'GET /conversations/:id/messages': () => ({
          body: { messages: [], hasMore: false },
        }),
        'GET /calls/targets': () => ({ body: [] }),
      },
    });

    fireEvent.click(
      await screen.findByRole('button', { name: /Message .*family about this trip/ }),
    );
    expect(await screen.findByText('No messages yet. Say hello.')).toBeTruthy();
    const opened = requests.find(
      (r) => r.method === 'POST' && r.path === '/conversations',
    );
    expect(opened?.body).toMatchObject({
      kind: 'dispatchFamily',
      organizationId: 'org-1',
    });
  });

  it('places a relay call and shows its progress', async () => {
    const { requests, messaging } = await renderApp('/messages/c-1', {
      routes: {
        'GET /conversations': () => ({ body: [conversationWire()] }),
        'GET /conversations/:id/messages': () => ({
          body: { messages: [], hasMore: false },
        }),
        'GET /calls/targets': () => ({
          body: [
            {
              kind: 'patient',
              id: 'p-1',
              label: 'Eleanor (patient)',
              available: true,
              unavailableReason: null,
            },
            {
              kind: 'familyMember',
              id: 'u-1',
              label: 'Sarah (daughter)',
              available: false,
              unavailableReason: 'No phone number on file.',
            },
          ],
        }),
        'POST /calls': () => ({
          status: 201,
          body: {
            id: 'call-1',
            status: 'initiating',
            calleeKind: 'patient',
            calleeLabel: 'Eleanor (patient)',
            conversationId: 'c-1',
            rideId: 'ride-1',
            startedAt: '2026-10-01T09:00:00Z',
            answeredAt: null,
            endedAt: null,
            durationSeconds: null,
          },
        }),
      },
    });

    expect(
      (
        await screen.findByRole('button', { name: 'Call Sarah (daughter)' })
      ).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Call Eleanor (patient)' }));
    expect(await screen.findByText(/Your phone is ringing/)).toBeTruthy();
    expect(requests.find((r) => r.path === '/calls')?.body).toEqual({
      conversationId: 'c-1',
      callee: { kind: 'patient', id: 'p-1' },
    });

    act(() => {
      messaging.socket.push({
        type: 'call',
        call: {
          id: 'call-1',
          status: 'inProgress',
          calleeKind: 'patient',
          calleeLabel: 'Eleanor (patient)',
          conversationId: 'c-1',
          rideId: 'ride-1',
          startedAt: new Date('2026-10-01T09:00:00Z'),
          answeredAt: new Date('2026-10-01T09:00:20Z'),
          endedAt: null,
          durationSeconds: null,
        },
      });
    });
    expect(await screen.findByText('Connected to Eleanor (patient)')).toBeTruthy();
  });

  it('says who is calling when the phone rings with a relay call', async () => {
    const { messaging } = await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    act(() => {
      messaging.socket.push({
        type: 'incoming',
        incoming: {
          callId: 'call-2',
          fromLabel: 'Marcus T.',
          conversationId: null,
          rideId: null,
        },
      });
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Marcus T. is calling your phone now',
    );
  });
});

describe('the live map', () => {
  it('lists the cars under way, and says when a position is too old to show', async () => {
    await renderApp('/map', {
      routes: {
        'GET /organizations/:id/dispatch/live': () => ({
          body: liveBoard({
            rides: [
              liveRide(),
              liveRide({
                rideId: 'ride-2',
                driverName: 'Ana P.',
                position: {
                  latitude: 40.6,
                  longitude: -73.9,
                  accuracyMeters: 8,
                  capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
                },
              }),
            ],
          }),
        }),
      },
    });

    expect(await screen.findByText('2 rides under way')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByLabelText('Arriving in about 7 minutes')).toBeTruthy();
    // No ETA next to a car nobody has heard from.
    expect(screen.getByText('Lost contact — position not shown')).toBeTruthy();
    expect(screen.getAllByText(/~\d+ min/)).toHaveLength(1);
  });

  it('lets an admin place a radius on the map and save it', async () => {
    const { requests } = await renderApp('/map', {
      routes: {
        'GET /organizations/:id/dispatch/live': () => ({
          body: liveBoard({ rides: [] }),
        }),
        'PUT /organizations/:id/service-area': (request) => ({
          body: {
            organizationId: 'org-1',
            serviceArea: { ...(request.body as object), points: null },
            updatedAt: null,
          },
        }),
      },
    });

    expect(await screen.findByText(/Not set/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set area' }));
    // Nothing to save until a centre is chosen.
    expect(
      (screen.getByRole('button', { name: 'Save area' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Click the map' }));
    fireEvent.change(screen.getByLabelText('Radius (miles)'), {
      target: { value: '12' },
    });
    expect(screen.getByText('area: radius')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save area' }));

    await waitFor(() =>
      expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({
        kind: 'radius',
        center: { latitude: 40.7, longitude: -73.9 },
        radiusMiles: 12,
      }),
    );
  });

  it('does not offer a dispatcher the controls to change the area', async () => {
    await renderApp('/map', {
      routes: {
        'GET /organizations': () => ({ body: [organization({ role: 'dispatcher' })] }),
        'GET /organizations/:id/dispatch/live': () => ({
          body: liveBoard({ rides: [] }),
        }),
      },
    });
    expect(await screen.findByText('Owners and admins can change it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set area' })).toBeNull();
  });

  it('flags a queued pickup outside the area, and only a definite one', async () => {
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([
            queueItem({ rideId: 'out', pickupInServiceArea: false }),
            queueItem({ rideId: 'in', pickupInServiceArea: true }),
            queueItem({ rideId: 'unknown', pickupInServiceArea: null }),
          ]),
        }),
      },
    });
    await screen.findAllByText('Margaret H.');
    expect(
      screen.getAllByLabelText('Pickup is outside your service area'),
    ).toHaveLength(1);
  });
});
