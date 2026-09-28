import { ArrowLeft, LayoutDashboard, LogOut, ReceiptText, ToggleRight, Undo2 } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

import { IconButton } from '../../components/ui';
import { useSession, useStore } from '../../state/context';
import { Rail, type Destination } from '../ConsoleShell';

const destinations: Destination[] = [
  // `end`, because `/admin` is a prefix of every other entry and would
  // otherwise stay highlighted on all four.
  { path: '/admin', icon: LayoutDashboard, label: 'Overview', end: true },
  { path: '/admin/audit', icon: ReceiptText, label: 'Audit' },
  { path: '/admin/flags', icon: ToggleRight, label: 'Flags' },
  { path: '/admin/refunds', icon: Undo2, label: 'Refunds' },
];

/**
 * The frame the administration screens sit in. A port of
 * apps/ops_console/lib/features/admin/admin_shell.dart.
 *
 * A **separate** frame from the console's, and that is the point: every
 * operational screen is scoped to one operator; nothing here is. An owner has
 * complete authority over their own company and none over anybody else's,
 * while platform support has a narrow read-only view across all of them — two
 * different axes, and a shared frame would suggest they are the same one.
 */
export function AdminShell() {
  const store = useStore();
  const navigate = useNavigate();
  const hasOperator = useSession().organizationId !== null;

  return (
    <div className="shell admin">
      <header className="app-bar">
        {/*
          Named rather than "CareBridge ops": an action taken here reaches every
          operator, and nobody should have to infer which surface they are in.
        */}
        <h1 className="app-title">CareBridge administration</h1>
        <div className="app-actions">
          <IconButton
            icon={ArrowLeft}
            label={hasOperator ? 'Back to dispatch' : 'Choose an operator'}
            onClick={() => navigate(hasOperator ? '/queue' : '/organizations')}
          />
          <IconButton icon={LogOut} label="Sign out" onClick={() => void store.signOut()} />
        </div>
      </header>
      <div className="shell-body">
        <Rail label="Administration" destinations={destinations} />
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
