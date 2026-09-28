import { ArrowLeftRight, ChevronRight, CircleCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Modal, useFeedback } from '../../components/feedback';
import { AppCard, Avatar, Divider } from '../../components/ui';
import {
  addressShortLine,
  mobilityNeedLabel,
  patientFirstInitial,
} from '../../domain/models';
import { activePatients, selectedPatient } from '../../state/careState';
import { useCare, useStore } from '../../state/context';

/**
 * Switches between the people a user cares for. Shown even with one person:
 * the name at the top answers "whose information am I looking at", and a
 * family managing two parents must never have to guess.
 */
export function PatientSwitcher() {
  const state = useCare();
  const store = useStore();
  const navigate = useNavigate();
  const { showFailure } = useFeedback();
  const [picking, setPicking] = useState(false);

  const patient = selectedPatient(state);
  if (!patient) return null;

  const all = activePatients(state);
  const others = all.filter((p) => p.id !== patient.id);
  const needs = patient.mobilityNeeds;

  const open = () => {
    if (others.length === 0 && all.length === 1) navigate(`/patients/${patient.id}`);
    else setPicking(true);
  };

  return (
    <>
      <AppCard
        onClick={open}
        ariaLabel={`Currently viewing ${patient.preferredName}. ${others.length === 0 ? 'Open profile.' : 'Tap to switch person.'}`}
      >
        <div className="row">
          <Avatar text={patientFirstInitial(patient)} size="lg" />
          <div className="grow">
            <p className="t-small muted">Caring for</p>
            <p className="t-title-lg" style={{ marginTop: 2 }}>
              {patient.preferredName}
            </p>
            {needs.length > 0 && (
              <div className="wrap" style={{ gap: 6, marginTop: 6 }}>
                {needs.slice(0, 2).map((need) => (
                  <span key={need} className="need-chip">
                    {mobilityNeedLabel[need]}
                  </span>
                ))}
                {needs.length > 2 && <span className="t-small muted">+{needs.length - 2} more</span>}
              </div>
            )}
          </div>
          {others.length === 0 ? (
            <ChevronRight className="muted" aria-hidden />
          ) : (
            <ArrowLeftRight className="muted" aria-hidden />
          )}
        </div>
      </AppCard>

      {picking && (
        <Modal sheet title="Who are you caring for?" onClose={() => setPicking(false)}>
          <div className="stack">
            {all.map((p) => (
              <button
                key={p.id}
                type="button"
                className="tile"
                onClick={async () => {
                  // Closed first: the switch is a preference write, and making the
                  // sheet hang on a round trip would make choosing feel slow.
                  setPicking(false);
                  try {
                    await store.selectPatient(p.id);
                  } catch (error) {
                    showFailure(error);
                  }
                }}
              >
                <Avatar text={patientFirstInitial(p)} />
                <span className="grow">
                  <span className="tile-title" style={{ display: 'block' }}>
                    {p.preferredName}
                  </span>
                  <span className="tile-sub">{addressShortLine(p.homeAddress)}</span>
                </span>
                {p.id === patient.id && <CircleCheck className="ink-primary" aria-label="Selected" />}
              </button>
            ))}
            <Divider />
            <button
              type="button"
              className="tile"
              onClick={() => {
                setPicking(false);
                navigate('/patients/new');
              }}
            >
              <UserPlus aria-hidden />
              <span className="tile-title grow">Add someone else</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
