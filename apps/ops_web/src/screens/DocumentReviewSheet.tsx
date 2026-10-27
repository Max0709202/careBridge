import { CircleAlert, CircleCheck, ExternalLink, Hourglass } from 'lucide-react';
import { useState } from 'react';

import type { DriverCompliance, DriverDocument } from '../api/codec';
import { failureMessage } from '../api/failures';
import { Modal, useFeedback } from '../components/feedback';
import { Button, Card, EmptyState, LoadingBlock, TextField } from '../components/ui';
import { useRun } from '../components/useRun';
import { documentLabel } from '../core/format';
import { useResource, useStore } from '../state/context';
import { keys } from '../state/opsStore';

const documentStatusLabel: Record<string, string> = {
  awaitingUpload: 'Awaiting upload',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

/**
 * Reviewing a driver's paperwork. A port of
 * apps/ops_console/lib/features/documents/document_review_sheet.dart.
 *
 *  - **The compliance line is the reason Approve is grey** on the roster.
 *  - **Opening a document is a deliberate act.** It mints a short-lived link
 *    and writes an audit row naming who looked — so a button, not a
 *    thumbnail every scroll would fetch.
 *  - **A rejection needs its reason typed before the button works.**
 */
export function DocumentReviewSheet(props: {
  organizationId: string;
  driverId: string;
  driverName: string;
  onClose: () => void;
}) {
  const { organizationId, driverId } = props;
  const documents = useResource(keys.documents(organizationId, driverId), (api) =>
    api.documentsFor(organizationId, driverId),
  );

  let body;
  if (documents.value) {
    const data = documents.value;
    const current = data.documents.filter((d) => !d.superseded);
    body = (
      <>
        <ComplianceLine compliance={data} />
        <div className="stack gap-sm sheet-scroll">
          {current.length === 0 ? (
            <p className="muted">Nothing has been handed in yet.</p>
          ) : (
            current.map((document) => (
              <DocumentRow
                key={document.id}
                organizationId={organizationId}
                driverId={driverId}
                document={document}
              />
            ))
          )}
        </div>
      </>
    );
  } else if (documents.error) {
    body = (
      <EmptyState
        icon={CircleAlert}
        title="Could not load the paperwork"
        message={failureMessage(documents.error)}
      />
    );
  } else {
    body = <LoadingBlock />;
  }

  return (
    <Modal sheet title={`${props.driverName} — paperwork`} onClose={props.onClose}>
      {body}
      <div className="dialog-actions">
        <Button variant="text" onClick={props.onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function ComplianceLine({ compliance }: { compliance: DriverCompliance }) {
  if (compliance.compliant) {
    return (
      <p className="row gap-xs">
        <CircleCheck size={20} className="ink-primary" aria-hidden />
        <span>
          {compliance.expiringSoon.length === 0
            ? 'Everything current. This driver can be approved.'
            : `Approvable, but renew soon: ${compliance.expiringSoon.map(documentLabel).join(', ')}.`}
        </span>
      </p>
    );
  }
  // Everything missing, not just the first: they need different phone calls.
  return (
    <p className="row gap-xs">
      <Hourglass size={20} className="error-text" aria-hidden />
      <span>
        Cannot be approved yet — still missing:{' '}
        {compliance.missing.map(documentLabel).join(', ')}.
      </span>
    </p>
  );
}

function DocumentRow(props: {
  organizationId: string;
  driverId: string;
  document: DriverDocument;
}) {
  const { organizationId, driverId, document } = props;
  const store = useStore();
  const { showFailure } = useFeedback();
  const { run, busy } = useRun();
  const [note, setNote] = useState('');
  const awaitingDecision = document.status === 'submitted';

  async function open() {
    // Opened synchronously, inside the click, so a popup blocker allows it;
    // pointed at the link once it is minted. `noopener` keeps the storage page
    // from reaching back into the console.
    const tab = window.open('about:blank', '_blank');
    try {
      const view = await store.guard(() =>
        store.api.viewDocument(organizationId, driverId, document.id),
      );
      if (tab) {
        tab.opener = null;
        tab.location.href = view.url;
      } else {
        window.open(view.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      tab?.close();
      showFailure(error);
    }
  }

  async function review(approve: boolean) {
    const result = await run(() =>
      store.guard(() =>
        store.api.reviewDocument({
          organizationId,
          driverId,
          documentId: document.id,
          approve,
          note: note.trim(),
        }),
      ),
    );
    if (result.ok) {
      store.invalidate(keys.documents(organizationId, driverId));
      // The roster shows approvability, so it has to re-read too.
      store.invalidate(keys.drivers(organizationId));
    }
  }

  return (
    <Card>
      <div className="row">
        <span className="t-title grow">{documentLabel(document.kind)}</span>
        <span className="t-label">
          {documentStatusLabel[document.status] ?? document.status}
        </span>
      </div>
      {document.reviewNote && <p className="t-small mt-xs">{document.reviewNote}</p>}
      <div className="actions-row">
        <Button
          variant="outlined"
          icon={ExternalLink}
          disabled={busy}
          onClick={() => void open()}
        >
          Open
        </Button>
        {awaitingDecision && (
          <>
            <Button disabled={busy} onClick={() => void review(true)}>
              Approve
            </Button>
            <Button
              variant="outlined"
              disabled={busy || note.trim() === ''}
              onClick={() => void review(false)}
            >
              Reject
            </Button>
          </>
        )}
      </div>
      {awaitingDecision && (
        <TextField
          className="mt-sm"
          label="Reason, if rejecting"
          helper="The driver sees this. “Rejected” with no reason is the same photograph uploaded three times."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </Card>
  );
}
