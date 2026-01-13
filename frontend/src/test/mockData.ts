import type { Session, Bunk, Camper, Constraint } from '../types/app-types';
import type { BunkPlansResponse, AttendeesResponse, PersonsResponse } from '../types/pocketbase-types';
import { AttendeesStatusOptions, Collections } from '../types/pocketbase-types';

export const mockSession = (overrides?: Partial<Session>): Session => ({
  id: 'session1',
  cm_id: 1001,
  name: 'main1',
  session_type: 'main',
  start_date: '2024-06-15',
  end_date: '2024-07-13',
  year: 2024,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockBunk = (overrides?: Partial<Bunk>): Bunk => ({
  id: 'bunk1',
  cm_id: 201,
  session: 'session1',
  name: 'Bunk 1',
  code: 'B1',
  capacity: 12,
  year: 2024,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockPerson = (overrides?: Partial<PersonsResponse>): PersonsResponse => ({
  id: 'person1',
  cm_id: 3001,
  first_name: 'Emma',
  last_name: 'Johnson',
  preferred_name: 'Emma',
  birthdate: '2014-03-15',
  gender: 'F',
  gender_identity_name: 'Girl/woman',
  gender_pronoun_name: 'She/her',
  grade: 5,
  is_camper: true,
  years_at_camp: 2,
  address: null,
  age: 10,
  email_addresses: null,
  phone_numbers: null,
  raw_data: null,
  gender_identity_id: 1,
  gender_identity_write_in: '',
  gender_pronoun_id: 1,
  gender_pronoun_write_in: '',
  household_id: 400,
  last_year_attended: 2023,
  school: 'Elementary School',
  year: 2024,
  collectionId: Collections.Persons,
  collectionName: Collections.Persons,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockCamper = (overrides?: Partial<Camper>): Camper => ({
  id: '3001:1001',
  name: 'Emma Johnson',
  first_name: 'Emma',
  last_name: 'Johnson',
  age: 10,
  grade: 5,
  gender: 'F',
  session_cm_id: 1001,
  person_cm_id: 3001,
  birthdate: '2014-03-15',
  pronouns: 'She/her',
  gender_identity_name: 'Girl/woman',
  gender_pronoun_name: 'She/her',
  household_id: 400,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockAttendee = (overrides?: Partial<AttendeesResponse>): AttendeesResponse => ({
  id: 'attendee1',
  person: 'person1',
  session: 'session1',
  enrollment_date: '2024-01-01T00:00:00Z',
  is_active: true,
  status: AttendeesStatusOptions.enrolled,
  status_id: 1,
  year: 2024,
  person_id: 3001, // For backend sync only
  collectionId: Collections.Attendees,
  collectionName: Collections.Attendees,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockConstraint = (overrides?: Partial<Constraint>): Constraint => ({
  id: 'constraint1',
  constraint_type: 'pair_together',
  session_id: 1001,
  pair_camper1_id: 3001,
  pair_camper2_id: 3002,
  description: 'Friends from same school',
  year: 2024,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  ...overrides,
})

export const mockBunkPlan = (overrides?: Partial<BunkPlansResponse>): BunkPlansResponse => ({
  id: 'bunkplan1',
  year: 2024,
  bunk: 'bunk1',
  session: 'session1',
  name: 'Bunk 1 Plan',
  cm_id: 5001,
  code: 'BP1',  // Required field
  collectionId: Collections.BunkPlans,
  collectionName: Collections.BunkPlans,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
  expand: {
    bunk: mockBunk(),
  },
  ...overrides,
})

// Create arrays of mock data
export const mockSessions = [
  mockSession(),
  mockSession({ 
    id: 'session2', 
    cm_id: 1002,
    name: 'main2',
    start_date: '2024-07-15',
    end_date: '2024-08-12'
  }),
]

export const mockBunks = [
  mockBunk(),
  mockBunk({ 
    id: 'bunk2', 
    cm_id: 202,
    name: 'Bunk 2',
    code: 'B2'
  }),
  mockBunk({ 
    id: 'bunk3', 
    cm_id: 203,
    name: 'Bunk 10',
    code: 'B10',
    capacity: 14,
  }),
]

export const mockCampers = [
  mockCamper(),
  mockCamper({
    id: '3002:1001',
    person_cm_id: 3002,
    name: 'Olivia Johnson',
    first_name: 'Olivia',
    last_name: 'Johnson',
  }),
  mockCamper({
    id: '3003:1001',
    person_cm_id: 3003,
    name: 'Alex Chen',
    first_name: 'Alex',
    last_name: 'Chen',
    age: 11,
    grade: 6,
    gender: 'NB',
    gender_identity_name: 'Non-binary',
    gender_pronoun_name: 'They/them',
    pronouns: 'They/them',
    household_id: 401,
  }),
]