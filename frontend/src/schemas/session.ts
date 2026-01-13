/**
 * Zod schemas for session-related collections: camp_sessions, bunk_plans
 */
import { z } from 'zod';
import {
  BaseSystemFieldsSchema,
  IsoDateStringSchema,
  RecordIdStringSchema,
} from './common';

// Session type enum
export const CampSessionsSessionTypeSchema = z.enum([
  'main',
  'embedded',
  'ag',
  'family',
  'quest',
  'training',
  'bmitzvah',
  'tli',
  'adult',
  'school',
  'hebrew',
  'teen',
  'other',
]);

// Camp sessions record schema
export const CampSessionsRecordSchema = z.object({
  cm_id: z.number(),
  end_date: IsoDateStringSchema,
  name: z.string(),
  parent_id: z.number().optional(),
  session_type: CampSessionsSessionTypeSchema,
  start_date: IsoDateStringSchema,
  year: z.number(),
});

// Full camp sessions response (with system fields)
export const CampSessionsResponseSchema = CampSessionsRecordSchema.merge(BaseSystemFieldsSchema);

// Bunk plans record schema
export const BunkPlansRecordSchema = z.object({
  bunk: RecordIdStringSchema,
  cm_id: z.number(),
  code: z.string().optional(),
  name: z.string(),
  session: RecordIdStringSchema,
  year: z.number(),
});

// Full bunk plans response (with system fields)
export const BunkPlansResponseSchema = BunkPlansRecordSchema.merge(BaseSystemFieldsSchema);

// Export types
export type CampSessionsSessionType = z.infer<typeof CampSessionsSessionTypeSchema>;
export type CampSessionsRecord = z.infer<typeof CampSessionsRecordSchema>;
export type CampSessionsResponse = z.infer<typeof CampSessionsResponseSchema>;
export type BunkPlansRecord = z.infer<typeof BunkPlansRecordSchema>;
export type BunkPlansResponse = z.infer<typeof BunkPlansResponseSchema>;
