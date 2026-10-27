import {
  ChevronRight,
  Plus,
  ToggleLeft,
  ToggleRight,
  TriangleAlert,
} from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { Modal, useConfirm } from '../../components/feedback';
import {
  Button,
  Card,
  EmptyState,
  LoadFailure,
  LoadingBlock,
  RefreshButton,
  Screen,
  StaleBanner,
  Switch,
  TextArea,
  TextField,
} from '../../components/ui';
import { useRun } from '../../components/useRun';
import { formatDayTime } from '../../core/format';
import { flagSummary, takesAwayBy, type FeatureFlag } from '../../domain/admin';
import { useResource, useStore } from '../../state/context';
import { keys } from '../../state/opsStore';

/**
 * Feature flags, and the one confirmation that matters. A port of
 * apps/ops_console/lib/features/admin/flags_screen.dart.
 *
 * Widening a rollout is ordinary. **Narrowing one takes a feature away from
 * people who already have it**, which reads to them as a bug — so it is
 * confirmed, in words, before it is sent. The server refuses a narrowing that
 * did not say so; this screen makes the refusal a question rather than an
 * error.
 */
export function FlagsScreen() {
  const flags = useResource(keys.flags, (api) => api.flags());
  // undefined: closed. null: creating. A flag: editing it.
  const [editing, setEditing] = useState<FeatureFlag | null | undefined>(undefined);

  let body;
  if (flags.value) {
    body = (
      <>
        {flags.error ? (
          <StaleBanner error={flags.error} onRetry={flags.reload} />
        ) : null}
        {flags.value.length === 0 ? (
          <EmptyState
            icon={ToggleLeft}
            title="No flags yet"
            message="A flag appears here once something creates it. “New flag” creates one."
          />
        ) : (
          <ul className="list">
            {flags.value.map((flag) => (
              <li key={flag.key}>
                <FlagCard flag={flag} onEdit={() => setEditing(flag)} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (flags.error) {
    body = <LoadFailure title="Could not load the flags" onRetry={flags.reload} />;
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Screen
      title="Feature flags"
      actions={
        <>
          <RefreshButton onClick={flags.reload} />
          <Button icon={Plus} onClick={() => setEditing(null)}>
            New flag
          </Button>
        </>
      }
    >
      {body}
      {editing !== undefined && (
        <FlagDialog existing={editing} onClose={() => setEditing(undefined)} />
      )}
    </Screen>
  );
}

/** What the flag is doing, said in a sentence rather than two numbers to combine. */
function FlagCard({ flag, onEdit }: { flag: FeatureFlag; onEdit: () => void }) {
  return (
    <Card onClick={onEdit} label={`Edit ${flag.key}`}>
      <div className="row">
        {flag.enabled ? (
          <ToggleRight size={22} className="ink-positive" aria-label="Enabled" />
        ) : (
          <ToggleLeft size={22} className="muted" aria-label="Disabled" />
        )}
        <span className="t-title grow">{flag.key}</span>
        <ChevronRight size={20} aria-hidden />
      </div>
      <p className="mt-xs">{flag.description}</p>
      <p className="t-small muted mt-xs">{flagSummary(flag)}</p>
      <p className="t-small outline">
        Changed {formatDayTime(flag.updatedAt)}
        {flag.updatedByName ? ` by ${flag.updatedByName}` : ''}
      </p>
    </Card>
  );
}

function FlagDialog({
  existing,
  onClose,
}: {
  existing: FeatureFlag | null;
  onClose: () => void;
}) {
  const store = useStore();
  const confirm = useConfirm();
  const { run, busy } = useRun();
  const sliderId = useId();

  const [key, setKey] = useState(existing?.key ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [percent, setPercent] = useState(existing?.rolloutPercent ?? 100);

  // A new flag can never narrow — nobody holds it yet.
  const takesAway = existing ? takesAwayBy(existing, { enabled, percent }) : false;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (key.trim() === '' || description.trim() === '') return;

    if (takesAway && existing) {
      const ok = await confirm({
        title: 'This takes the feature away',
        message: !enabled
          ? `Switching ${existing.key} off removes it from everybody who has it right now, including the ${existing.rolloutPercent}% it was rolled out to. They will see it disappear.`
          : `Narrowing ${existing.key} from ${existing.rolloutPercent}% to ${percent}% removes it from people who already have it. To them that reads as a bug rather than as a decision.`,
        cancelLabel: 'Keep as it is',
        confirmLabel: 'Take it away',
      });
      if (!ok) return;
    }

    // Includes the refusal a support account gets for a write, shown as the
    // server words it.
    const result = await run(() =>
      store.guard(() =>
        store.api.setFlag({
          key: key.trim(),
          description,
          enabled,
          rolloutPercent: percent,
          // Sent only when it was actually asked.
          confirmNarrowing: takesAway,
        }),
      ),
    );
    if (result.ok) {
      store.invalidate(keys.flags);
      onClose();
    }
  }

  return (
    <Modal title={existing ? existing.key : 'New flag'} onClose={onClose}>
      <form
        className="stack gap-sm dialog-scroll"
        onSubmit={(e) => void save(e)}
        noValidate
      >
        {!existing && (
          <TextField
            label="Key"
            helper="What the code asks for, e.g. marketplace"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        )}
        <TextArea
          label="Description"
          helper="What this switches on, for whoever reads it next"
          counter={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Switch
          label="Enabled"
          // Checked before the percentage, so off is instant and complete.
          description="Off here means off for everybody, whatever the rollout says."
          checked={enabled}
          onChange={setEnabled}
        />
        <div className="field">
          <label htmlFor={sliderId}>Rollout: {percent}%</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={!enabled}
            onChange={(e) => setPercent(Number(e.target.value))}
          />
          <div className="helper">
            Applied to a stable hash of the subject, so the same person is on the same
            side of the line on every request.
          </div>
        </div>
        {takesAway && (
          <p className="note t-small">
            <TriangleAlert size={16} className="ink-imminent" aria-hidden />
            <span>
              This takes the feature away from people who have it. You will be asked to
              confirm.
            </span>
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="text" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            busy={busy}
            disabled={key.trim() === '' || description.trim() === ''}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
