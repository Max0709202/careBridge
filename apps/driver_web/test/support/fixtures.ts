import type { components } from '../../src/api/schema';

type S = components['schemas'];

export const address = (line1 = '400 Parkside Avenue'): S['AddressDto'] => ({
  label: 'Home',
  line1,
  line2: null,
  city: 'Brooklyn',
  state: 'NY',
  postalCode: '11226',
  accessNotes: 'Ring 3B.',
  latitude: 40.65,
  longitude: -73.95,
});

export const ride = (overrides: Partial<S['DriverRideDto']> = {}): S['DriverRideDto'] => ({
  id: 'ride-1',
  status: 'driverArrived',
  scheduledPickupAt: '2026-06-15T14:00:00Z',
  direction: 'outbound',
  passengerName: 'Margaret',
  passengerPhone: '+1-555-0147',
  pickup: address(),
  destination: address('451 Clarkson Avenue'),
  wheelchairRequired: true,
  assistanceRequired: false,
  notesForDriver: 'Walks with a frame.',
  isDelayed: false,
  availableTransitions: ['passengerOnboard', 'noShow'],
  noShowAvailableInSeconds: 120,
  shareLocation: true,
  lastCapturedAt: null,
  ...overrides,
});

export const profile = (overrides: Partial<S['DriverProfileDto']> = {}): S['DriverProfileDto'] => ({
  driverId: 'driver-1',
  organizationId: 'org-1',
  organizationName: 'Parkside Transport',
  displayName: 'Dev Patel',
  status: 'approved',
  onShift: false,
  canWork: true,
  suspensionReason: null,
  vehicle: {
    id: 'vehicle-1',
    make: 'Toyota',
    model: 'Sienna',
    color: 'Silver',
    licensePlate: 'KXT 4410',
    isWheelchairAccessible: true,
  },
  ...overrides,
});

export const documents = (overrides: Partial<S['DriverDocumentsDto']> = {}): S['DriverDocumentsDto'] => ({
  compliant: false,
  missing: ['vehicleInsurance'],
  expiringSoon: [],
  documents: [
    {
      id: 'doc-1',
      kind: 'driversLicence',
      status: 'rejected',
      contentType: 'image/jpeg',
      byteSize: 1000,
      expiresAt: null,
      submittedAt: '2026-06-01T10:00:00Z',
      reviewedAt: '2026-06-02T10:00:00Z',
      reviewNote: 'The expiry date is not readable.',
      superseded: false,
    },
  ],
  ...overrides,
});
