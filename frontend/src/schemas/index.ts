/**
 * Zod schemas for runtime validation at API boundaries
 *
 * These schemas mirror the PocketBase collection types and provide:
 * - Runtime validation for API responses
 * - Type inference (use z.infer<typeof Schema> for types)
 * - Better error messages when API contracts change
 *
 * Usage:
 *   import { PersonsResponseSchema } from '@/schemas';
 *   const person = PersonsResponseSchema.parse(apiResponse);
 */

// Common schemas
export {
  IsoDateStringSchema,
  RecordIdStringSchema,
  BaseSystemFieldsSchema,
  AuthSystemFieldsSchema,
  AddressSchema,
  PhoneNumberSchema,
  EmailAddressSchema,
  nullableJson,
  type IsoDateString,
  type RecordIdString,
  type BaseSystemFields,
  type AuthSystemFields,
  type Address,
  type PhoneNumber,
  type EmailAddress,
} from './common';

// Camper schemas
export {
  AttendeesStatusSchema,
  PersonsRecordSchema,
  PersonsResponseSchema,
  AttendeesRecordSchema,
  AttendeesResponseSchema,
  type AttendeesStatus,
  type PersonsRecord,
  type PersonsResponse,
  type AttendeesRecord,
  type AttendeesResponse,
} from './camper';

// Session schemas
export {
  CampSessionsSessionTypeSchema,
  CampSessionsRecordSchema,
  CampSessionsResponseSchema,
  BunkPlansRecordSchema,
  BunkPlansResponseSchema,
  type CampSessionsSessionType,
  type CampSessionsRecord,
  type CampSessionsResponse,
  type BunkPlansRecord,
  type BunkPlansResponse,
} from './session';

// Bunk schemas
export {
  BunksRecordSchema,
  BunksResponseSchema,
  BunkAssignmentsRecordSchema,
  BunkAssignmentsResponseSchema,
  BunkAssignmentsDraftRecordSchema,
  BunkAssignmentsDraftResponseSchema,
  type BunksRecord,
  type BunksResponse,
  type BunkAssignmentsRecord,
  type BunkAssignmentsResponse,
  type BunkAssignmentsDraftRecord,
  type BunkAssignmentsDraftResponse,
} from './bunk';

// Request schemas
export {
  BunkRequestsRequestTypeSchema,
  BunkRequestsStatusSchema,
  BunkRequestsSourceSchema,
  BunkRequestsRecordSchema,
  BunkRequestsResponseSchema,
  OriginalBunkRequestsFieldSchema,
  OriginalBunkRequestsRecordSchema,
  OriginalBunkRequestsResponseSchema,
  type BunkRequestsRequestType,
  type BunkRequestsStatus,
  type BunkRequestsSource,
  type BunkRequestsRecord,
  type BunkRequestsResponse,
  type OriginalBunkRequestsField,
  type OriginalBunkRequestsRecord,
  type OriginalBunkRequestsResponse,
} from './request';
