import { Accessibility, Ban, CircleCheck, CircleDot } from 'lucide-react';
import { useState } from 'react';

import { Modal } from '../components/feedback';
import { Button, TextArea } from '../components/ui';
import { useRun } from '../components/useRun';
import { isReassignment, reasonLabels, type Candidate, type QueueItem } from '../domain/models';
import { useStore } from '../state/context';

/**
 * Picks a driver for a ride. A port of
 * apps/ops_console/lib/features/queue/assign_sheet.dart.
 *
 * Ineligible candidates are **listed, not hidden**, each with every reason
 * they cannot take it: a roster of eight showing two leaves the dispatcher
 * unable to tell whether the other six are busy, off shift or in the wrong
 * vehicle — three different phone calls. What the sheet refuses is letting one
 * be *chosen*; the server refuses too.
 */
export function AssignSheet(props: { organizationId: string; item: QueueItem; onClose: (assigned: boolean) => void }) {
  const { item } = props;
  const store = useStore();
  const { run, busy } = useRun();
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const needsReason = isReassignment(item);
  const canSubmit = selected !== null && (!needsReason || reason.trim() !== '');

  // Eligible first, then alphabetical. Ineligible ones stay; they stop being
  // the first thing the eye lands on.
  const candidates = [...item.candidates].sort((a, b) =>
    a.eligible !== b.eligible ? (a.eligible ? -1 : 1) : a.displayName.localeCompare(b.displayName),
  );

  async function submit() {
    if (!selected) return;
    // The server asserts eligibility rather than advising it, so a race — the
    // driver taking another trip since the queue loaded — arrives as a
    // refusal. Shown as it is, and the sheet stays open to pick another.
    const result = await run(() =>
      store.guard(() =>
        store.api.assign({
          organizationId: props.organizationId,
          rideId: item.rideId,
          driverId: selected,
          reason: needsReason ? reason.trim() : undefined,
        }),
      ),
    );
    if (result.ok) props.onClose(true);
  }

  return (
    <Modal sheet title={needsReason ? 'Reassign this trip' : 'Assign a driver'} onClose={() => props.onClose(false)}>
      <div>
        <p className="t-small muted">
          {item.patientName} · {item.pickupLine}
        </p>
        {item.wheelchairRequired && (
          <p className="row gap-xs t-small mt-xs">
            <Accessibility size={16} aria-hidden /> Needs a wheelchair-accessible vehicle
          </p>
        )}
      </div>
      <div className="candidates" role="radiogroup" aria-label="Drivers">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.driverId}
            candidate={candidate}
            selected={selected === candidate.driverId}
            onSelect={() => setSelected(candidate.driverId)}
          />
        ))}
      </div>
      {needsReason && (
        <TextArea
          label="Why is this being reassigned?"
          // Shown on the family's timeline, so they are not left wondering why
          // the name at the kerb changed.
          helper="The family sees that the trip changed driver."
          counter={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <div className="dialog-actions">
        <Button variant="text" onClick={() => props.onClose(false)}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!canSubmit} busy={busy}>
          {busy ? 'Assigning…' : 'Confirm'}
        </Button>
      </div>
    </Modal>
  );
}

function CandidateRow(props: { candidate: Candidate; selected: boolean; onSelect: () => void }) {
  const { candidate, selected } = props;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`candidate${selected ? ' selected' : ''}`}
      disabled={!candidate.eligible}
      onClick={props.onSelect}
    >
      {candidate.eligible ? (
        <CircleCheck size={20} className="ink-positive" aria-hidden />
      ) : (
        <Ban size={20} className="muted" aria-hidden />
      )}
      <span className="grow stack">
        <span>{candidate.displayName}</span>
        {/* Every reason, not the first. */}
        {!candidate.eligible && <span className="t-small muted">{reasonLabels(candidate).join(' · ')}</span>}
      </span>
      {selected && <CircleDot size={20} className="ink-primary" aria-hidden />}
    </button>
  );
}
