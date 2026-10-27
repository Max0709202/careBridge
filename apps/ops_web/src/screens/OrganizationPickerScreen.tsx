import { Building2, ChevronRight, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Button,
  Card,
  EmptyState,
  IconButton,
  LoadFailure,
  LoadingBlock,
} from '../components/ui';
import { canDispatch } from '../domain/models';
import { useOrganizations, usePlatformAccess, useStore } from '../state/context';

/**
 * Which operator this session is dispatching for. A port of
 * apps/ops_console/lib/features/organizations/organization_picker_screen.dart.
 *
 * Always a choice, never a default — even with only one. Somebody who
 * dispatches for two companies looking at the wrong queue sees an empty list,
 * and an empty list reads as "no work" rather than "wrong screen".
 */
export function OrganizationPickerScreen() {
  const store = useStore();
  const navigate = useNavigate();
  const organizations = useOrganizations();
  const isPlatform = usePlatformAccess();

  useEffect(() => {
    document.title = 'Choose an operator · CareBridge ops';
  }, []);

  let body;
  const list = organizations.value;
  if (list === null) {
    body = organizations.error ? (
      <LoadFailure
        title="Could not load your operators"
        onRetry={organizations.reload}
      />
    ) : (
      <LoadingBlock />
    );
  } else if (list.length === 0) {
    // An account that exists but holds no membership. For a platform account
    // this is not a dead end: platform standing and operator membership are
    // separate axes, and administration does not need one.
    body = (
      <EmptyState
        icon={Building2}
        title="No operators yet"
        message={
          isPlatform
            ? 'This account is not a member of any transport operator, so there is no queue to work. The administration surface does not need one.'
            : 'This account is not a member of any transport operator. Ask an owner or administrator to add you.'
        }
        action={
          isPlatform ? (
            <Button onClick={() => navigate('/admin')}>Open administration</Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <ul className="list">
        {list.map((organization) => {
          const allowed = canDispatch(organization);
          const content = (
            <div className="row">
              <div className="grow">
                <div className="t-title">{organization.name}</div>
                <div className="t-small muted">{organization.role}</div>
                {/* A `member` holds a membership without being able to dispatch — said plainly. */}
                {!allowed && (
                  <div className="t-small error-text mt-xs">
                    This role cannot use the dispatch console.
                  </div>
                )}
              </div>
              {allowed && <ChevronRight size={20} aria-hidden />}
            </div>
          );
          return (
            <li key={organization.id}>
              {allowed ? (
                <Card
                  label={`${organization.name}, ${organization.role}`}
                  onClick={() => store.selectOrganization(organization.id)}
                >
                  {content}
                </Card>
              ) : (
                <Card>{content}</Card>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="shell">
      <header className="app-bar">
        <h1 className="app-title">Choose an operator</h1>
        <div className="app-actions">
          {isPlatform && (
            <IconButton
              icon={ShieldCheck}
              label="Administration"
              onClick={() => navigate('/admin')}
            />
          )}
          <IconButton
            icon={LogOut}
            label="Sign out"
            onClick={() => void store.signOut()}
          />
        </div>
      </header>
      <main className="picker">{body}</main>
    </div>
  );
}
