import {
  ArrowLeftRight,
  Car,
  CreditCard,
  ListChecks,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  ReceiptText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { IconButton } from '../components/ui';
import { useInbox } from '../messaging/react';
import { IncomingCallBanner } from './messages/IncomingCallBanner';
import {
  usePlatformAccess,
  useSelectedOrganization,
  useSession,
  useStore,
} from '../state/context';

export interface Destination {
  path: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  /** A count to show on the item — unread messages. */
  badge?: number;
}

const destinations: Destination[] = [
  { path: '/queue', icon: ListChecks, label: 'Queue' },
  { path: '/map', icon: MapIcon, label: 'Live map' },
  { path: '/messages', icon: MessageSquare, label: 'Messages' },
  { path: '/roster', icon: Users, label: 'Roster' },
  { path: '/fleet', icon: Car, label: 'Fleet' },
  { path: '/seats', icon: ReceiptText, label: 'Seats' },
  { path: '/billing', icon: CreditCard, label: 'Billing' },
];

/**
 * The frame every operational screen sits in. A port of
 * apps/ops_console/lib/app/shell.dart.
 *
 * A rail on a wide screen and a bottom bar on a narrow one — not a drawer: a
 * dispatcher moves between the queue and the roster constantly, and a
 * navigation surface that has to be opened first adds a click to the loop
 * that runs most often.
 */
export function ConsoleShell() {
  const store = useStore();
  const navigate = useNavigate();
  const organization = useSelectedOrganization();
  const { organizationId } = useSession();
  const isPlatform = usePlatformAccess();
  const { inbox } = useInbox();
  // Unread for the operator on screen only: another company's messages are
  // that company's, and a badge here for them would be a badge you cannot clear.
  const unread = (inbox ?? [])
    .filter((c) => c.organizationId === organizationId)
    .reduce((sum, c) => sum + c.unreadCount, 0);
  const items = destinations.map((d) =>
    d.path === '/messages' ? { ...d, badge: unread } : d,
  );

  return (
    <div className="shell">
      <IncomingCallBanner />
      <header className="app-bar">
        {/*
          The operator is named in the title bar at all times. Somebody
          dispatching for two companies must never have to infer which queue
          they are looking at from its contents.
        */}
        <h1 className="app-title">{organization?.name ?? 'CareBridge ops'}</h1>
        {organization && <span className="app-role">{organization.role}</span>}
        <div className="app-actions">
          {/*
            Administration is a separate job done by different people, so it
            is one door out of this frame rather than more rail items competing
            with the queue. Shown only to an account the server answered a
            platform read for.
          */}
          {isPlatform && (
            <IconButton
              icon={ShieldCheck}
              label="Administration"
              onClick={() => navigate('/admin')}
            />
          )}
          <IconButton
            icon={ArrowLeftRight}
            label="Switch operator"
            onClick={() => {
              store.selectOrganization(null);
              navigate('/organizations');
            }}
          />
          <IconButton
            icon={LogOut}
            label="Sign out"
            onClick={() => void store.signOut()}
          />
        </div>
      </header>
      <div className="shell-body">
        <Rail label="Console" destinations={items} />
        {/* Keyed by operator, so switching never shows one company's screen state under another's name. */}
        <main className="shell-content" key={organizationId ?? ''}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** A rail on a wide window, a bottom bar on a narrow one — the same links, restyled by CSS. */
export function Rail(props: { label: string; destinations: Destination[] }) {
  return (
    <nav className="rail" aria-label={props.label}>
      {props.destinations.map(({ path, icon: Icon, label, end, badge }) => (
        <NavLink
          key={path}
          to={path}
          end={end}
          className="rail-item"
          aria-label={badge ? `${label}, ${badge} unread` : undefined}
        >
          <span className="rail-icon">
            <Icon size={22} aria-hidden />
            {badge ? (
              <span className="badge rail-badge" aria-hidden>
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
