import { History, Settings2, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { useFeedback } from '../../components/feedback';
import { Button, Card, EmptyState, LoadFailure, LoadingBlock, Screen, TextField } from '../../components/ui';
import { formatDayTimeSeconds } from '../../core/format';
import { actorLabel, isEmptyFilter, isSystem, type AuditEntry, type AuditFilter } from '../../domain/admin';
import { useStore } from '../../state/context';

/**
 * The audit log. A port of apps/ops_console/lib/features/admin/audit_screen.dart.
 *
 * **It pages by cursor and appends.** Rows arrive while somebody is reading;
 * an offset page would skip the rows that shifted under it, and a log that
 * quietly omits rows is the one failure a log cannot have.
 *
 * **It shows field names, never values** — the server's restraint, and what
 * lets support staff read the log without being entitled to the records it
 * describes.
 */
export function AuditScreen() {
  const store = useStore();
  const { showFailure } = useFeedback();

  const [draft, setDraft] = useState<Required<AuditFilter>>({ action: '', entityType: '', entityId: '' });
  const [filter, setFilter] = useState<AuditFilter>({});
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Only the newest walk may write: a slow first page from an old filter must
  // not land on top of the new one.
  const walk = useRef(0);

  /**
   * The first page under a filter, discarding what was held. A filter change
   * starts a new keyset walk; appending across filters would produce a list
   * that answers two questions and says which for neither.
   */
  const reload = useCallback(
    async (next: AuditFilter) => {
      const id = ++walk.current;
      setLoading(true);
      setError(null);
      try {
        const page = await store.guard(() => store.api.auditLog(next));
        if (walk.current !== id) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
      } catch (e) {
        if (walk.current === id) setError(e);
      } finally {
        if (walk.current === id) setLoading(false);
      }
    },
    [store],
  );

  useEffect(() => {
    void reload(filter);
  }, [reload, filter]);

  async function appendPage() {
    if (!cursor || appending) return;
    const id = walk.current;
    setAppending(true);
    try {
      // The cursor comes from the previous page and from nowhere else.
      const page = await store.guard(() => store.api.auditLog(filter, cursor));
      if (walk.current !== id) return;
      setEntries((held) => [...held, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (e) {
      showFailure(e);
    } finally {
      setAppending(false);
    }
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    setFilter({
      action: draft.action.trim(),
      entityType: draft.entityType.trim(),
      entityId: draft.entityId.trim(),
    });
  }

  function clear() {
    setDraft({ action: '', entityType: '', entityId: '' });
    setFilter({});
  }

  let body;
  if (loading) {
    body = <LoadingBlock />;
  } else if (error) {
    body = <LoadFailure title="Could not read the log" onRetry={() => void reload(filter)} />;
  } else if (entries.length === 0) {
    // An empty result under a filter is ambiguous: "nothing happened" or
    // "that is not what the action is called".
    body = (
      <EmptyState
        icon={History}
        title="Nothing matches"
        message={
          isEmptyFilter(filter)
            ? 'No audited actions have been recorded yet.'
            : 'No audited action matches that filter. Actions are dotted, like driver.approved or ride.assigned.'
        }
      />
    );
  } else {
    body = (
      <>
        <ul className="list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <AuditRow entry={entry} />
            </li>
          ))}
        </ul>
        <div className="list-footer">
          {cursor ? (
            <Button variant="outlined" busy={appending} onClick={() => void appendPage()}>
              {appending ? 'Loading…' : 'Load more'}
            </Button>
          ) : (
            <span className="t-small muted">End of the log for this filter.</span>
          )}
        </div>
      </>
    );
  }

  return (
    <Screen title="Audit log" wide>
      <form className="filters" onSubmit={apply}>
        <TextField
          label="Action"
          // Matched as a prefix by the server: "driver." is a useful query.
          helper="Prefix, e.g. driver."
          value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value })}
        />
        <TextField
          label="Entity type"
          helper="e.g. Ride"
          value={draft.entityType}
          onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
        />
        <TextField
          label="Entity id"
          helper="Everything that happened to one record"
          value={draft.entityId}
          onChange={(e) => setDraft({ ...draft, entityId: e.target.value })}
        />
        <div className="filter-actions">
          <Button type="submit">Search</Button>
          {!isEmptyFilter(filter) && (
            <Button variant="text" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </form>
      {body}
    </Screen>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const system = isSystem(entry);
  return (
    <Card>
      <div className="row start">
        {/* A person and a scheduled job are different kinds of actor, and that is the first thing a reader needs. */}
        {system ? (
          <Settings2 size={18} className="muted" aria-label="Scheduled job" />
        ) : (
          <User size={18} className="muted" aria-label="Person" />
        )}
        <span className="t-body-lg grow">
          {actorLabel(entry)} — {entry.action}
        </span>
        <span className="t-small muted nowrap">{formatDayTimeSeconds(entry.at)}</span>
      </div>
      <div className="t-small muted mt-xs">
        {entry.entityId === null ? entry.entityType : `${entry.entityType} ${entry.entityId}`}
      </div>
      {/* Names, never values — and the wording says so. */}
      {entry.changedFields.length > 0 && (
        <div className="t-small mt-xs">Fields changed: {entry.changedFields.join(', ')}</div>
      )}
      {/* The join between this row and the request logs. */}
      {entry.correlationId && <div className="t-small outline mt-xs">Correlation {entry.correlationId}</div>}
    </Card>
  );
}
