/**
 * Whole-app flows against a fake API. Ports of the behaviours in
 * apps/ops_console/test/*_screen_test.dart, plus the routing rules.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { OpsApi } from '../src/api/opsApi';
import { InMemoryTokenStore } from '../src/api/tokens';
import { App } from '../src/App';
import { ConfirmProvider, FeedbackProvider } from '../src/components/feedback';
import { StoreProvider } from '../src/state/context';
import { OpsStore } from '../src/state/opsStore';
import { fakeServer, type Handler } from './support/fakeServer';
import {
  account,
  auditEntry,
  candidate,
  driver,
  flag,
  invoice,
  organization,
  plan,
  queue,
  queueItem,
  refundable,
  stats,
  subscription,
} from './support/fixtures';

const BASE = 'http://localhost/api/v1';

async function renderApp(
  path: string,
  options: { signedIn?: boolean; organizationId?: string | null; routes?: Record<string, Handler> } = {},
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
    ...options.routes,
  });
  const tokens = new InMemoryTokenStore();
  if (options.signedIn ?? true) tokens.write({ accessToken: 'a', refreshToken: 'r' });
  const organizationId = options.organizationId === undefined ? 'org-1' : options.organizationId;
  if (organizationId) window.sessionStorage.setItem('carebridge.ops.organizationId', organizationId);

  const store = new OpsStore(new OpsApi(tokens, BASE, server.fetchImpl), window.sessionStorage);
  store.restoreSession();

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
  return { ...server, store, tokens };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('signing in and choosing an operator', () => {
  it('sends a signed-out dispatcher to sign-in, then to a choice, never a default', async () => {
    const { requests } = await renderApp('/queue', { signedIn: false, organizationId: null });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dispatch@example.com ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // Even with one operator, the picker asks.
    fireEvent.click(await screen.findByRole('button', { name: 'Meridian Transit, owner' }));
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
          body: { error: { code: 'validation', field: 'mfaCode', message: 'Enter your code.' } },
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
      routes: { 'GET /organizations': () => ({ body: [organization({ role: 'member' })] }) },
    });
    expect(await screen.findByText('This role cannot use the dispatch console.')).toBeTruthy();
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
    expect(await screen.findByRole('heading', { name: 'CareBridge administration' })).toBeTruthy();
  });

  it('keeps the operator across a reload, and drops it when the membership is gone', async () => {
    await renderApp('/queue', {
      organizationId: 'org-gone',
      routes: { 'GET /organizations': () => ({ body: [organization()] }) },
    });
    expect(await screen.findByRole('heading', { name: 'Choose an operator' })).toBeTruthy();
    expect(window.sessionStorage.getItem('carebridge.ops.organizationId')).toBeNull();
  });

  it('switching operator actually reaches the picker', async () => {
    await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch operator' }));
    expect(await screen.findByRole('heading', { name: 'Choose an operator' })).toBeTruthy();
  });
});

describe('the queue', () => {
  it('an empty queue says so rather than showing a blank panel', async () => {
    await renderApp('/queue', { routes: { 'GET /organizations/:id/dispatch/queue': () => ({ body: queue([], 3) }) } });
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
                candidate({ driverId: 'd2', eligible: false, reasons: ['offShift', 'noAccessibleVehicle'] }),
              ],
            }),
          ]),
        }),
      },
    });
    expect(await screen.findByText('Nobody available for this trip')).toBeTruthy();
    expect(screen.getByText('2 × Not on shift — Put them on shift from the roster')).toBeTruthy();
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
                candidate({ driverId: 'd-busy', displayName: 'Anna B.', eligible: false, reasons: ['alreadyOnARide'] }),
                candidate(),
              ],
            }),
          ]),
        }),
        'POST /organizations/:id/dispatch/rides/:ride/assign': () => ({ body: queue([]) }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Assign (1 available)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Assign a driver' });
    // Ineligible candidates are listed, not hidden — and cannot be chosen.
    const busy = within(sheet).getByRole('radio', { name: /Anna B\./ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(within(sheet).getByText('Already on a trip')).toBeTruthy();

    const confirm = within(sheet).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('radio', { name: /Marcus T\./ }));
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const assign = requests.find((r) => r.path.endsWith('/assign'))!;
    expect(assign.path).toBe('/organizations/org-1/dispatch/rides/ride-1/assign');
    expect(assign.body).toEqual({ driverId: 'driver-1' });
    expect(assign.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(requests.filter((r) => r.path.endsWith('/dispatch/queue')).length).toBe(2));
  });

  it('a reassignment will not go until it says why', async () => {
    const { requests } = await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () => ({
          body: queue([queueItem({ status: 'reassignmentRequired' })]),
        }),
        'POST /organizations/:id/dispatch/rides/:ride/assign': () => ({ body: queue([]) }),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign (1 available)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reassign this trip' });
    fireEvent.click(within(sheet).getByRole('radio', { name: /Marcus T\./ }));
    const confirm = within(sheet).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Why is this being reassigned?'), {
      target: { value: 'Flat tyre' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/assign'))?.body).toEqual({ driverId: 'driver-1', reason: 'Flat tyre' }),
    );
  });

  it('a failure offers a retry rather than a stack trace', async () => {
    let fail = true;
    await renderApp('/queue', {
      routes: {
        'GET /organizations/:id/dispatch/queue': () =>
          fail ? { status: 500, body: { error: { code: 'internal' } } } : { body: queue([], 0) },
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
        'PUT /organizations/:id/drivers/:d/shift': () => ({ body: driver({ onShift: false }) }),
      },
    });
    const shift = await screen.findByRole('switch', { name: 'On shift' });
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paperwork' })).toBeNull();
    fireEvent.click(shift);
    await waitFor(() => expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({ onShift: false }));
  });

  it('suspending asks why, and will not go without an answer', async () => {
    const { requests } = await renderApp('/roster', {
      routes: { 'POST /organizations/:id/drivers/:d/status': () => ({ body: driver({ status: 'suspended' }) }) },
    });
    expect(await screen.findByText('Occupies a billable seat')).toBeTruthy();
    // Approved drivers can be suspended or offboarded — never re-approved.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog', { name: 'Why suspended?' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Insurance lapsed' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/status'))?.body).toEqual({ to: 'suspended', reason: 'Insurance lapsed' }),
    );
  });

  it('paperwork says what is missing, and a rejection needs a reason', async () => {
    await renderApp('/roster', {
      routes: {
        'GET /organizations/:id/drivers': () => ({ body: [driver({ status: 'pendingApproval', occupiesSeat: false })] }),
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
    expect(await within(sheet).findByText(/still missing: Vehicle insurance/)).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Reason, if rejecting'), { target: { value: 'Blurred' } });
    expect((within(sheet).getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('billing', () => {
  it('an operator with no plan is told what happens instead, and offered the ladder', async () => {
    await renderApp('/billing', {
      routes: { 'GET /organizations/:id/billing': () => ({ body: account({ subscription: null }) }) },
    });
    expect(await screen.findByText(/takes a margin on each fare instead/)).toBeTruthy();
    expect(await screen.findByText('Up to 25 drivers: $15.00 each')).toBeTruthy();
    expect(screen.getByText('Beyond that: $12.00 per driver')).toBeTruthy();
    expect(screen.getByText(/14-day free trial/)).toBeTruthy();
  });

  it('a subscription with no card behind it says so', async () => {
    await renderApp('/billing', {
      routes: { 'GET /organizations/:id/billing': () => ({ body: account({ paymentMethod: null }) }) },
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
        'GET /organizations/:id/billing': () => ({ body: account({ subscription: subscription({ status: 'pastDue' }) }) }),
      },
    });
    expect(await screen.findByText(/keeps working for the plan’s grace window/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Subscription: Payment failed' })).toBeTruthy();
  });

  it('switching interval explains that money moves today, and waits for a yes', async () => {
    const { requests } = await renderApp('/billing', {
      routes: { 'POST /organizations/:id/billing/change-interval': () => ({ body: account() }) },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to yearly' }));
    const dialog = await screen.findByRole('dialog', { name: 'Switch to yearly billing' });
    expect(within(dialog).getByText(/credited and a fresh period starts today/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch' }));
    await waitFor(() =>
      expect(requests.find((r) => r.path.endsWith('/change-interval'))?.body).toEqual({ interval: 'annual' }),
    );
  });

  it('an invoice in dunning offers a way to pay it now', async () => {
    await renderApp('/billing', {
      routes: {
        'GET /organizations/:id/billing/invoices': () => ({
          body: [invoice({ status: 'open', attemptCount: 2, paidAt: null, nextAttemptAt: null })],
        }),
      },
    });
    expect(await screen.findByText(/Payment failed 2 time\(s\)\. No further attempt is scheduled\./)).toBeTruthy();
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
  const admin = { 'GET /admin/stats': () => ({ body: stats({ staleTrackingNow: 2 }) }) };

  it('is a door only for an account the server answered a platform read for', async () => {
    await renderApp('/queue');
    await screen.findByRole('heading', { name: 'Queue' });
    expect(screen.queryByRole('button', { name: 'Administration' })).toBeNull();
    cleanup();
    await renderApp('/queue', { routes: admin });
    fireEvent.click(await screen.findByRole('button', { name: 'Administration' }));
    expect(await screen.findByRole('heading', { name: 'CareBridge administration' })).toBeTruthy();
  });

  it('a stale trip is presented as a telephone call', async () => {
    await renderApp('/admin', { routes: admin });
    expect(await screen.findByText('2 trip(s) in flight have not reported a position recently')).toBeTruthy();
    expect(screen.getByText(/Telephone the driver/)).toBeTruthy();
  });

  it('a week where nothing finished is not reported as 0%', async () => {
    await renderApp('/admin', {
      routes: { 'GET /admin/stats': () => ({ body: stats({ ridesCompletedLast7Days: 0 }) }) },
    });
    expect(await screen.findByText('Nothing is waiting on a person right now.')).toBeTruthy();
    expect(screen.getByText('No trips have reached an end state in the last seven days.')).toBeTruthy();
  });

  it('the audit log pages by cursor and shows names, never values', async () => {
    const { requests } = await renderApp('/admin/audit', {
      routes: {
        'GET /admin/audit': (r) =>
          r.path.includes('cursor=')
            ? { body: { entries: [auditEntry({ id: 'a2', action: 'ride.assigned' })], nextCursor: null } }
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
    await waitFor(() => expect(requests.map((r) => r.path)).toContain('/admin/audit?action=driver.'));
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
    fireEvent.change(within(dialog).getByLabelText('Rollout: 50%'), { target: { value: '10' } });
    expect(within(dialog).getByText(/You will be asked to confirm/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const confirm = await screen.findByRole('dialog', { name: 'This takes the feature away' });
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
        'GET /admin/invoices/:id/refunds': () => ({ body: refundable({ refundableCents: 5000 }) }),
        'POST /admin/invoices/:id/refunds': () => ({ body: refundable({ refundableCents: 2550 }) }),
      },
    });
    fireEvent.change(screen.getByLabelText('Invoice id'), { target: { value: 'inv-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }));

    const dialog = await screen.findByRole('dialog', { name: 'Refund invoice CB-0001' });
    const amount = within(dialog).getByLabelText('Amount') as HTMLInputElement;
    expect(amount.value).toBe('50.00');
    fireEvent.change(amount, { target: { value: '60' } });
    fireEvent.change(within(dialog).getByLabelText('Why'), { target: { value: 'Charged twice' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send the money back' }));
    expect(await within(dialog).findByText('Only $50.00 is left on this payment.')).toBeTruthy();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);

    fireEvent.change(amount, { target: { value: '24.50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send the money back' }));
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
