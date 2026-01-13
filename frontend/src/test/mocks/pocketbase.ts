import { vi } from 'vitest'
import { mockSessions, mockBunks, mockCampers, mockAttendee, mockBunkPlan } from '../mockData'

// Mock PocketBase client
export const mockPocketBase = {
  authStore: {
    isValid: true,
    token: 'mock-token',
    model: { id: 'admin', email: 'admin@camp.local' },
  },
  
  collection: vi.fn((name: string) => {
    const collections: Record<string, unknown> = {
      sessions: {
        getList: vi.fn().mockResolvedValue({
          items: mockSessions,
          page: 1,
          perPage: 30,
          totalItems: mockSessions.length,
          totalPages: 1,
        }),
        getOne: vi.fn((id: string) => 
          Promise.resolve(mockSessions.find(s => s.id === id))
        ),
      },
      
      bunks: {
        getList: vi.fn().mockResolvedValue({
          items: mockBunks,
          page: 1,
          perPage: 30,
          totalItems: mockBunks.length,
          totalPages: 1,
        }),
      },
      
      persons: {
        getList: vi.fn().mockResolvedValue({
          items: mockCampers,
          page: 1,
          perPage: 30,
          totalItems: mockCampers.length,
          totalPages: 1,
        }),
        getOne: vi.fn((id: string) => 
          Promise.resolve(mockCampers.find(c => c.id === id))
        ),
      },
      
      attendees: {
        getList: vi.fn().mockResolvedValue({
          items: [mockAttendee()],
          page: 1,
          perPage: 30,
          totalItems: 1,
          totalPages: 1,
        }),
        update: vi.fn().mockResolvedValue(mockAttendee()),
      },
      
      bunk_plans: {
        getList: vi.fn().mockResolvedValue({
          items: [mockBunkPlan()],
          page: 1,
          perPage: 30,
          totalItems: 1,
          totalPages: 1,
        }),
      },
      
      bunk_assignments: {
        getList: vi.fn().mockResolvedValue({
          items: [],
          page: 1,
          perPage: 30,
          totalItems: 0,
          totalPages: 0,
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-assignment' }),
        delete: vi.fn().mockResolvedValue(true),
      },
      
      constraints: {
        getList: vi.fn().mockResolvedValue({
          items: [],
          page: 1,
          perPage: 30,
          totalItems: 0,
          totalPages: 0,
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-constraint' }),
        update: vi.fn().mockResolvedValue({ id: 'updated-constraint' }),
        delete: vi.fn().mockResolvedValue(true),
      },
    }
    
    return collections[name] || {
      getList: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      getOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-item' }),
      update: vi.fn().mockResolvedValue({ id: 'updated-item' }),
      delete: vi.fn().mockResolvedValue(true),
    }
  }),
  
  admins: {
    authWithPassword: vi.fn().mockResolvedValue({
      token: 'mock-admin-token',
      admin: { id: 'admin', email: 'admin@camp.local' },
    }),
  },
  
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}

// Mock the PocketBase import
vi.mock('pocketbase', () => ({
  default: vi.fn(() => mockPocketBase),
}))

export const resetPocketBaseMocks = () => {
  // Reset all mocks in the PocketBase mock
  const collectionMock = mockPocketBase.collection as ReturnType<typeof vi.fn>;
  if (collectionMock.mockReset) {
    collectionMock.mockReset();
  }
}