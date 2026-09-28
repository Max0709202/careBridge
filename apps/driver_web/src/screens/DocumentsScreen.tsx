import {
  CalendarX,
  CircleCheck,
  CircleAlert,
  CircleMinus,
  Hourglass,
  RefreshCw,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { DocumentKind, DriverDocument, DriverDocuments } from '../api/codec';
import { useFeedback } from '../components/feedback';
import { useRun } from '../components/useRun';
import { Button, Centered, FailureBlock, IconButton, InfoCard, Page, Spinner } from '../components/ui';
import { useDriver, useStore } from '../state/context';
import { formatDate } from './format';

/**
 * The driver's paperwork. Two jobs that pull against each other: an upload easy
 * enough to do in a car park, and a clear *why* when something was rejected.
 */
export function DocumentsScreen() {
  const store = useStore();
  const { documents } = useDriver();

  useEffect(() => {
    void store.refreshDocuments();
  }, [store]);

  let body;
  if (documents.value) {
    const data = documents.value;
    body = (
      <div className="stack gap-md">
        <Summary documents={data} />
        <div className="stack gap-sm">
          {kinds.map((kind) => (
            <DocumentTile key={kind} kind={kind} documents={data} />
          ))}
        </div>
      </div>
    );
  } else if (documents.error) {
    body = <FailureBlock error={documents.error} onRetry={() => void store.refreshDocuments()} />;
  } else {
    body = (
      <Centered>
        <Spinner />
      </Centered>
    );
  }

  return (
    <Page
      title="Your paperwork"
      back="/today"
      actions={<IconButton icon={RefreshCw} label="Refresh" onClick={() => void store.refreshDocuments()} />}
    >
      {body}
    </Page>
  );
}

/** The order somebody has them to hand: a licence in a wallet, then the glovebox. */
const kinds: DocumentKind[] = ['driversLicence', 'vehicleInsurance', 'vehicleRegistration', 'backgroundCheck'];

export function documentLabel(kind: string): string {
  switch (kind) {
    case 'driversLicence':
      return 'Driving licence';
    case 'vehicleInsurance':
      return 'Vehicle insurance';
    case 'vehicleRegistration':
      return 'Vehicle registration';
    case 'backgroundCheck':
      return 'Background check';
    default:
      return kind;
  }
}

function Summary({ documents }: { documents: DriverDocuments }) {
  if (documents.compliant) {
    return (
      <InfoCard>
        <div className="row start">
          <CircleCheck className="ink-primary" aria-hidden style={{ flex: '0 0 auto' }} />
          <p className="grow">Everything your operator needs is on file. They can approve you to drive.</p>
        </div>
      </InfoCard>
    );
  }
  return (
    <InfoCard label="Still needed">
      <p className="t-title">Still needed</p>
      {/* Every missing document, not just the first. */}
      <p className="mt-xs">{documents.missing.map(documentLabel).join(', ')}</p>
      {documents.expiringSoon.length > 0 && (
        <p className="mt-md">
          Renew soon: {documents.expiringSoon.map(documentLabel).join(', ')}. These lapse within a month, and you
          come off the road the day they do.
        </p>
      )}
    </InfoCard>
  );
}

function DocumentTile({ kind, documents }: { kind: DocumentKind; documents: DriverDocuments }) {
  const store = useStore();
  const { showConfirmation } = useFeedback();
  const { run, busy } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const document = documents.documents.find((d) => d.kind === kind && !d.superseded) ?? null;

  async function upload(file: File) {
    const result = await run(() => store.uploadDocument(kind, file));
    if (result.ok) showConfirmation('Sent to your operator to review.');
  }

  return (
    <InfoCard label={documentLabel(kind)}>
      <div className="row">
        <h2 className="t-title grow">{documentLabel(kind)}</h2>
        <StatusChip status={document?.status ?? null} />
      </div>
      {document?.reviewNote && (
        // The reason, in the reviewer's own words.
        <p className="error-text mt-sm">{document.reviewNote}</p>
      )}
      {document?.expiresAt && <p className="t-small mt-xs">Expires {formatDate(new Date(document.expiresAt))}</p>}
      {/* Camera or gallery, the browser's own choice: a driver has usually
          already photographed their documents. */}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <Button variant="outlined" icon={Upload} busy={busy} className="mt-md" onClick={() => input.current?.click()}>
        {document === null ? 'Add a photo' : 'Replace'}
      </Button>
    </InfoCard>
  );
}

/** Icon and word, never colour alone. */
function StatusChip({ status }: { status: DriverDocument['status'] | null }) {
  const [Icon, label, ink]: [LucideIcon, string, string] = (() => {
    switch (status) {
      case 'approved':
        return [CircleCheck, 'Approved', 'ink-primary'];
      case 'submitted':
        return [Hourglass, 'With your operator', 'ink-tertiary'];
      case 'rejected':
        return [CircleAlert, 'Not accepted', 'error-text'];
      case 'expired':
        return [CalendarX, 'Expired', 'error-text'];
      case 'awaitingUpload':
        return [Upload, 'Not sent', 'muted'];
      default:
        return [CircleMinus, 'Nothing yet', 'muted'];
    }
  })();
  return (
    <span className={`status ${ink}`}>
      <Icon size={18} aria-hidden />
      {label}
    </span>
  );
}
