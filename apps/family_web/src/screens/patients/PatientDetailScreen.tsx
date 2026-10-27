import {
  CarFront,
  CircleCheck,
  CircleMinus,
  Cake,
  HandHeart,
  House,
  Info,
  Languages,
  Pencil,
  Phone,
  Star,
  User,
  Users,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  AppCard,
  Avatar,
  Button,
  Divider,
  IconButton,
  InfoRow,
  NotAvailable,
  Page,
  SectionHeader,
} from '../../components/ui';
import { maskPhone } from '../../core/formatting';
import {
  addressSingleLine,
  ageBandLabel,
  mobilityNeedLabel,
  needConstrainsVehicle,
  patientFirstInitial,
} from '../../domain/models';
import {
  accessCan,
  accessIsPrimary,
  FAMILY_PERMISSIONS,
  permissionLabel,
  relationshipLabel,
  type PatientAccess,
} from '../../domain/permissions';
import { can, canView, patientById } from '../../state/careState';
import { useCare } from '../../state/context';

export function PatientDetailScreen() {
  const { id = '' } = useParams();
  const state = useCare();
  const navigate = useNavigate();
  const patient = patientById(state, id);

  // A phone number, a home address and the notes a driver uses to find
  // someone's door: opens only against a live grant.
  if (!patient || !canView(state, id)) return <NotAvailable />;

  const access = state.access[id];
  const canEdit = can(state, id, 'manageAccess');

  return (
    <Page
      title={patient.preferredName}
      back
      actions={
        // Hidden rather than shown-and-refused: offering a control the rules
        // reject teaches people the app is unreliable.
        canEdit && (
          <IconButton
            icon={Pencil}
            label="Edit profile"
            onClick={() => navigate(`/patients/${id}/edit`)}
          />
        )
      }
    >
      <div className="stack">
        <AppCard>
          <div className="row">
            <Avatar text={patientFirstInitial(patient)} size="xl" />
            <div className="grow">
              <p className="t-headline">{patient.preferredName}</p>
              {patient.legalName && (
                <p className="t-small muted">Legal name: {patient.legalName}</p>
              )}
            </div>
          </div>
          <Divider />
          <InfoRow icon={Phone} label="Phone" value={patient.phone} />
          <InfoRow
            icon={House}
            label="Pickup address"
            value={addressSingleLine(patient.homeAddress)}
          />
          {patient.homeAddress.accessNotes && (
            <InfoRow
              icon={Info}
              label="How to find them"
              value={patient.homeAddress.accessNotes}
            />
          )}
          {patient.ageBand && (
            <InfoRow
              icon={Cake}
              label="Age range"
              value={ageBandLabel[patient.ageBand]}
            />
          )}
          <InfoRow
            icon={Languages}
            label="Preferred language"
            value={patient.preferredLanguage}
          />
        </AppCard>

        <div className="mt-lg">
          <SectionHeader title="Getting about" />
          <AppCard>
            {patient.mobilityNeeds.length === 0 ? (
              <p className="t-body muted">No mobility needs recorded.</p>
            ) : (
              <div className="wrap">
                {patient.mobilityNeeds.map((need) => {
                  const Icon = needConstrainsVehicle(need) ? CarFront : HandHeart;
                  return (
                    <span key={need} className="chip">
                      <Icon size={18} aria-hidden />
                      {mobilityNeedLabel[need]}
                    </span>
                  );
                })}
              </div>
            )}
            {patient.mobilityNotes && (
              <p className="t-body mt-sm">{patient.mobilityNotes}</p>
            )}
          </AppCard>
        </div>

        <div className="mt-lg">
          <SectionHeader title="Emergency contacts" />
          {patient.emergencyContacts.length === 0 ? (
            <AppCard>
              <p className="t-body muted">
                No emergency contact recorded. Add one so a driver or dispatcher knows
                who to call.
              </p>
            </AppCard>
          ) : (
            <div className="stack gap-sm">
              {patient.emergencyContacts.map((contact) => (
                <AppCard key={contact.id}>
                  <div className="row">
                    {contact.isPrimary ? (
                      <Star className="ink-primary" aria-label="Primary contact" />
                    ) : (
                      <User className="ink-primary" aria-hidden />
                    )}
                    <div className="grow">
                      <p className="t-body-lg">{contact.name}</p>
                      <p className="t-body muted">
                        {contact.relationship} · {maskPhone(contact.phone)}
                      </p>
                    </div>
                  </div>
                </AppCard>
              ))}
            </div>
          )}
        </div>

        {access && (
          <div className="mt-lg">
            <AccessSection patientId={id} access={access} />
          </div>
        )}
      </div>
    </Page>
  );
}

/**
 * What this account may do for this person — shown even with every
 * permission, because the point is to make the per-person access model visible.
 */
function AccessSection({
  patientId,
  access,
}: {
  patientId: string;
  access: PatientAccess;
}) {
  const navigate = useNavigate();
  return (
    <>
      <SectionHeader
        title="Your access"
        subtitle={
          accessIsPrimary(access)
            ? 'You are the organiser for this person.'
            : 'Granted by another family member.'
        }
      />
      <AppCard>
        <InfoRow
          icon={Users}
          label="Relationship"
          value={relationshipLabel[access.relationship]}
        />
        <Divider />
        {FAMILY_PERMISSIONS.map((permission) => {
          const granted = accessCan(access, permission);
          return (
            <div key={permission} className="row" style={{ gap: 12, padding: '6px 0' }}>
              {granted ? (
                <CircleCheck size={22} className="ink-positive" aria-label="Allowed" />
              ) : (
                <CircleMinus size={22} className="muted" aria-label="Not allowed" />
              )}
              <p className={`t-body grow ${granted ? '' : 'muted'}`}>
                {permissionLabel[permission]}
              </p>
            </div>
          );
        })}
        {accessCan(access, 'manageAccess') && (
          <>
            <Divider />
            <Button
              variant="outlined"
              icon={Users}
              block
              onClick={() => navigate(`/patients/${patientId}/care-circle`)}
            >
              Manage the care circle
            </Button>
          </>
        )}
      </AppCard>
    </>
  );
}
