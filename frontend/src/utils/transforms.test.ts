/**
 * Tests for transform utility functions
 */
import { describe, it, expect, vi } from 'vitest';
import {
  toAppCamper,
  toAppSession,
  toAppBunk,
  buildCampersFromData,
  createLookupMaps,
  toAppBunkRequest,
} from './transforms';
import {
  Collections,
  CampSessionsSessionTypeOptions,
  BunkRequestsRequestTypeOptions,
  BunkRequestsStatusOptions,
} from '../types/pocketbase-types';
import type {
  PersonsResponse,
  AttendeesResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
  BunkRequestsResponse,
} from '../types/pocketbase-types';

// Mock calculateAge to avoid date dependencies
vi.mock('./ageCalculator', () => ({
  calculateAge: vi.fn((birthdate: string) => {
    // Simple mock: return 10.05 for any birthdate
    if (birthdate === '2015-01-15') return 10.0;
    if (birthdate === '2014-06-15') return 10.06;
    return 10.05;
  }),
}));

// Helper to create minimal mock responses
// PocketBase types use Required<...Record> so we cast partial mocks
const createMockPerson = (overrides: Partial<PersonsResponse> = {}): PersonsResponse =>
  ({
    id: 'person-1',
    cm_id: 12345,
    is_camper: true,
    collectionId: 'coll-persons',
    collectionName: Collections.Persons,
    created: '2024-01-01',
    updated: '2024-01-01',
    ...overrides,
  }) as PersonsResponse;

const createMockAttendee = (overrides: Partial<AttendeesResponse> = {}): AttendeesResponse =>
  ({
    id: 'attendee-1',
    person: 'person-1',
    session: 'session-1',
    year: 2025,
    collectionId: 'coll-attendees',
    collectionName: Collections.Attendees,
    created: '2024-01-01',
    updated: '2024-01-01',
    ...overrides,
  }) as AttendeesResponse;

const createMockBunk = (overrides: Partial<BunksResponse> = {}): BunksResponse =>
  ({
    id: 'bunk-1',
    cm_id: 100,
    name: 'B-1',
    gender: 'M',
    year: 2025,
    collectionId: 'coll-bunks',
    collectionName: Collections.Bunks,
    created: '2024-01-01',
    updated: '2024-01-01',
    ...overrides,
  }) as BunksResponse;

const createMockSession = (overrides: Partial<CampSessionsResponse> = {}): CampSessionsResponse =>
  ({
    id: 'session-1',
    cm_id: 1001,
    name: 'Session 2',
    session_type: CampSessionsSessionTypeOptions.main,
    start_date: '2025-06-15',
    end_date: '2025-07-01',
    year: 2025,
    parent_id: 0,
    collectionId: 'coll-sessions',
    collectionName: Collections.CampSessions,
    created: '2024-01-01',
    updated: '2024-01-01',
    ...overrides,
  }) as CampSessionsResponse;

const createMockAssignment = (
  overrides: Partial<BunkAssignmentsResponse> = {}
): BunkAssignmentsResponse =>
  ({
    id: 'assign-1',
    person: 'p1',
    bunk: 'b1',
    session: 's1',
    year: 2025,
    cm_id: 1,
    bunk_plan: '',
    collectionId: 'coll-assignments',
    collectionName: Collections.BunkAssignments,
    created: '',
    updated: '',
    ...overrides,
  }) as BunkAssignmentsResponse;

const createMockBunkRequest = (overrides: Partial<BunkRequestsResponse> = {}): BunkRequestsResponse =>
  ({
    id: 'req-1',
    requester_id: 'p1',
    requestee_id: 'p2',
    request_type: BunkRequestsRequestTypeOptions.bunk_with,
    status: BunkRequestsStatusOptions.pending,
    priority: 3,
    session_id: 's1',
    year: 2025,
    original_text: 'wants to bunk with friend',
    confidence_score: 0.85,
    parse_notes: 'Parsed by AI',
    collectionId: 'coll-requests',
    collectionName: Collections.BunkRequests,
    created: '2024-01-01',
    updated: '2024-01-01',
    ...overrides,
  }) as BunkRequestsResponse;

describe('toAppCamper', () => {
  const mockPerson = createMockPerson({
    first_name: 'John',
    last_name: 'Doe',
    preferred_name: 'Johnny',
    birthdate: '2015-01-15',
    grade: 5,
    gender: 'M',
    years_at_camp: 3,
    school: 'Test Elementary',
    gender_pronoun_name: 'he/him',
    gender_identity_id: 1,
    gender_identity_name: 'Boy/Man',
    gender_identity_write_in: '',
    gender_pronoun_id: 1,
    gender_pronoun_write_in: '',
    household_id: 100,
  });

  const mockAttendee = createMockAttendee();
  const mockBunk = createMockBunk();
  const mockSession = createMockSession();

  it('should transform person and attendee to Camper', () => {
    const camper = toAppCamper(mockPerson, mockAttendee, null, null, null);

    expect(camper.person_cm_id).toBe(12345);
    expect(camper.first_name).toBe('John');
    expect(camper.last_name).toBe('Doe');
    expect(camper.preferred_name).toBe('Johnny');
    expect(camper.grade).toBe(5);
    expect(camper.gender).toBe('M');
    expect(camper.years_at_camp).toBe(3);
    expect(camper.school).toBe('Test Elementary');
    expect(camper.pronouns).toBe('he/him');
  });

  it('should include bunk info when provided', () => {
    const camper = toAppCamper(mockPerson, mockAttendee, null, mockBunk, null);

    expect(camper.assigned_bunk).toBe('bunk-1');
    expect(camper.assigned_bunk_cm_id).toBe(100);
  });

  it('should include session cm_id when provided', () => {
    const camper = toAppCamper(mockPerson, mockAttendee, null, null, mockSession);

    expect(camper.session_cm_id).toBe(1001);
    expect(camper.id).toBe('12345:1001');
  });

  it('should handle missing optional fields', () => {
    const minimalPerson = createMockPerson({ cm_id: 99999 });

    const camper = toAppCamper(minimalPerson, mockAttendee, null, null, null);

    expect(camper.first_name).toBe('');
    expect(camper.last_name).toBe('');
    expect(camper.preferred_name).toBe('');
    expect(camper.age).toBe(0);
    expect(camper.grade).toBe(0);
    expect(camper.gender).toBe('NB');
    expect(camper.years_at_camp).toBe(0);
  });

  it('should include gender identity fields when present', () => {
    const camper = toAppCamper(mockPerson, mockAttendee, null, null, null);

    expect(camper.gender_identity_id).toBe(1);
    expect(camper.gender_identity_name).toBe('Boy/Man');
    expect(camper.gender_pronoun_id).toBe(1);
    expect(camper.gender_pronoun_name).toBe('he/him');
    expect(camper.household_id).toBe(100);
  });

  it('should set expand property with session and bunk', () => {
    const camper = toAppCamper(mockPerson, mockAttendee, null, mockBunk, mockSession);

    expect(camper.expand?.session).toBe(mockSession);
    expect(camper.expand?.assigned_bunk).toBe(mockBunk);
  });
});

describe('toAppSession', () => {
  it('should transform CampSessionsResponse to Session', () => {
    const dbSession = createMockSession({ parent_id: 1000 });

    const session = toAppSession(dbSession);

    expect(session.id).toBe('session-1');
    expect(session.name).toBe('Session 2');
    expect(session.session_type).toBe('main');
    expect(session.start_date).toBe('2025-06-15');
    expect(session.end_date).toBe('2025-07-01');
    expect(session.cm_id).toBe(1001);
    expect(session.year).toBe(2025);
    expect(session.parent_id).toBe(1000);
  });

  it('should handle missing optional fields', () => {
    // Cast to override the session_type to undefined for testing default behavior
    const minimalSession = {
      ...createMockSession({
        id: 'session-2',
        cm_id: 1002,
        name: 'Test',
        start_date: '',
        end_date: '',
      }),
      session_type: undefined,
    } as unknown as CampSessionsResponse;

    const session = toAppSession(minimalSession);

    expect(session.start_date).toBe('');
    expect(session.end_date).toBe('');
    expect(session.session_type).toBe('main');
    expect(session.code).toBe('');
    expect(session.persistent_id).toBe('');
  });
});

describe('toAppBunk', () => {
  it('should transform BunksResponse to Bunk', () => {
    const dbBunk = createMockBunk();

    const bunk = toAppBunk(dbBunk);

    expect(bunk.id).toBe('bunk-1');
    expect(bunk.name).toBe('B-1');
    expect(bunk.cm_id).toBe(100);
    expect(bunk.gender).toBe('M');
    expect(bunk.year).toBe(2025);
    expect(bunk.capacity).toBe(0);
    expect(bunk.session).toBe('');
  });

  it('should handle missing dates', () => {
    const minimalBunk = createMockBunk({
      id: 'bunk-2',
      cm_id: 101,
      name: 'G-1',
      created: '',
      updated: '',
    });

    const bunk = toAppBunk(minimalBunk);

    // Should use current date for missing created/updated
    expect(bunk.created).toBeTruthy();
    expect(bunk.updated).toBeTruthy();
  });
});

describe('createLookupMaps', () => {
  it('should create empty maps when no data provided', () => {
    const maps = createLookupMaps({});

    expect(maps.assignments.size).toBe(0);
    expect(maps.bunks.size).toBe(0);
  });

  it('should create bunk map by cm_id', () => {
    const bunks: BunksResponse[] = [
      createMockBunk({ id: 'b1', cm_id: 100, name: 'B-1' }),
      createMockBunk({ id: 'b2', cm_id: 101, name: 'B-2' }),
    ];

    const maps = createLookupMaps({ bunks });

    expect(maps.bunks.size).toBe(2);
    expect(maps.bunks.get(100)?.name).toBe('B-1');
    expect(maps.bunks.get(101)?.name).toBe('B-2');
  });

  it('should create assignment map by person cm_id', () => {
    const assignments = [
      {
        ...createMockAssignment({ id: 'a1' }),
        expand: {
          person: createMockPerson({ id: 'p1', cm_id: 12345 }),
        },
      },
    ] as Array<BunkAssignmentsResponse<{ person?: PersonsResponse }>>;

    const maps = createLookupMaps({ assignments });

    expect(maps.assignments.size).toBe(1);
    expect(maps.assignments.get(12345)?.id).toBe('a1');
  });

  it('should skip assignments without expanded person', () => {
    const assignments = [
      createMockAssignment({ id: 'a1' }),
    ] as Array<BunkAssignmentsResponse<{ person?: PersonsResponse }>>;

    const maps = createLookupMaps({ assignments });

    expect(maps.assignments.size).toBe(0);
  });
});

describe('buildCampersFromData', () => {
  it('should build campers from attendees with expanded person', () => {
    const attendees = [
      {
        ...createMockAttendee({ id: 'a1' }),
        expand: {
          person: createMockPerson({
            id: 'p1',
            cm_id: 12345,
            first_name: 'John',
            last_name: 'Doe',
          }),
          session: createMockSession({ id: 's1', cm_id: 1001, name: 'Session 2' }),
        },
      },
    ] as Array<AttendeesResponse<{ person?: PersonsResponse; session?: CampSessionsResponse }>>;

    const campers = buildCampersFromData(attendees, new Map(), new Map());

    expect(campers).toHaveLength(1);
    expect(campers[0]?.first_name).toBe('John');
    expect(campers[0]?.last_name).toBe('Doe');
    expect(campers[0]?.session_cm_id).toBe(1001);
  });

  it('should skip non-camper persons', () => {
    const attendees = [
      {
        ...createMockAttendee({ id: 'a1' }),
        expand: {
          person: createMockPerson({
            id: 'p1',
            cm_id: 12345,
            first_name: 'Staff',
            last_name: 'Member',
            is_camper: false,
          }),
        },
      },
    ] as Array<AttendeesResponse<{ person?: PersonsResponse }>>;

    const campers = buildCampersFromData(attendees, new Map(), new Map());

    expect(campers).toHaveLength(0);
  });

  it('should skip attendees without person', () => {
    const attendees = [
      {
        ...createMockAttendee({ id: 'a1' }),
        expand: {},
      },
    ] as Array<AttendeesResponse<{ person?: PersonsResponse }>>;

    const campers = buildCampersFromData(attendees, new Map(), new Map());

    expect(campers).toHaveLength(0);
  });

  it('should include bunk from assignment map', () => {
    const attendees = [
      {
        ...createMockAttendee({ id: 'a1' }),
        expand: {
          person: createMockPerson({ id: 'p1', cm_id: 12345, first_name: 'John' }),
        },
      },
    ] as Array<AttendeesResponse<{ person?: PersonsResponse }>>;

    const bunk = createMockBunk({ id: 'b1', cm_id: 100, name: 'B-1' });

    const assignment = {
      ...createMockAssignment({ id: 'assign-1' }),
      expand: { bunk },
    } as BunkAssignmentsResponse<{ bunk?: BunksResponse }>;

    const assignments = new Map<number, BunkAssignmentsResponse<{ bunk?: BunksResponse }>>([
      [12345, assignment],
    ]);

    const campers = buildCampersFromData(attendees, assignments, new Map());

    expect(campers).toHaveLength(1);
    expect(campers[0]?.assigned_bunk).toBe('b1');
    expect(campers[0]?.assigned_bunk_cm_id).toBe(100);
  });
});

describe('toAppBunkRequest', () => {
  const baseRequest = createMockBunkRequest();

  it('should transform bunk_with request', () => {
    const request = toAppBunkRequest(baseRequest);

    expect(request.id).toBe('req-1');
    expect(request.request_type).toBe('bunk_with');
    expect(request.requester_id).toBe('p1');
    expect(request.requestee_id).toBe('p2');
    expect(request.priority).toBe(3);
    expect(request.status).toBe('pending');
    expect(request.original_text).toBe('wants to bunk with friend');
    expect(request.confidence_score).toBe(0.85);
    expect(request.parse_notes).toBe('Parsed by AI');
  });

  it('should transform not_bunk_with request', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ request_type: BunkRequestsRequestTypeOptions.not_bunk_with })
    );

    expect(request.request_type).toBe('not_bunk_with');
  });

  it('should transform age_preference request', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ request_type: BunkRequestsRequestTypeOptions.age_preference })
    );

    expect(request.request_type).toBe('age_preference');
  });

  it('should map resolved status', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ status: BunkRequestsStatusOptions.resolved })
    );

    expect(request.status).toBe('resolved');
  });

  it('should map declined status', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ status: BunkRequestsStatusOptions.declined })
    );

    expect(request.status).toBe('declined');
  });

  it('should default priority to 5 when missing', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ priority: undefined as unknown as number })
    );

    expect(request.priority).toBe(5);
  });

  it('should default confidence_score to 0 when missing', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ confidence_score: undefined as unknown as number })
    );

    expect(request.confidence_score).toBe(0);
  });

  it('should default original_text to empty string when missing', () => {
    const request = toAppBunkRequest(
      createMockBunkRequest({ original_text: undefined as unknown as string })
    );

    expect(request.original_text).toBe('');
  });

  it('should set is_reciprocal to false', () => {
    const request = toAppBunkRequest(baseRequest);

    expect(request.is_reciprocal).toBe(false);
  });
});
