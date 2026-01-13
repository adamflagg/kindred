/**
 * Zod schemas for bunk-related collections: bunks, bunk_assignments, bunk_assignments_draft
 */
import { z } from 'zod';
import {
  BaseSystemFieldsSchema,
  RecordIdStringSchema,
} from './common';

// Bunks record schema
export const BunksRecordSchema = z.object({
  cm_id: z.number(),
  gender: z.string().optional(),
  name: z.string(),
  year: z.number(),
});

// Full bunks response (with system fields)
export const BunksResponseSchema = BunksRecordSchema.merge(BaseSystemFieldsSchema);

// Bunk assignments record schema
export const BunkAssignmentsRecordSchema = z.object({
  bunk: RecordIdStringSchema.optional(),
  bunk_plan: RecordIdStringSchema.optional(),
  cm_id: z.number().optional(),
  person: RecordIdStringSchema.optional(),
  session: RecordIdStringSchema.optional(),
  year: z.number(),
});

// Full bunk assignments response (with system fields)
export const BunkAssignmentsResponseSchema = BunkAssignmentsRecordSchema.merge(BaseSystemFieldsSchema);

// Bunk assignments draft record schema
export const BunkAssignmentsDraftRecordSchema = z.object({
  assignment_locked: z.boolean().optional(),
  bunk: RecordIdStringSchema.optional(),
  bunk_plan: RecordIdStringSchema.optional(),
  person: RecordIdStringSchema.optional(),
  scenario: RecordIdStringSchema.optional(),
  session: RecordIdStringSchema.optional(),
  year: z.number(),
});

// Full bunk assignments draft response (with system fields)
export const BunkAssignmentsDraftResponseSchema = BunkAssignmentsDraftRecordSchema.merge(BaseSystemFieldsSchema);

// Export types
export type BunksRecord = z.infer<typeof BunksRecordSchema>;
export type BunksResponse = z.infer<typeof BunksResponseSchema>;
export type BunkAssignmentsRecord = z.infer<typeof BunkAssignmentsRecordSchema>;
export type BunkAssignmentsResponse = z.infer<typeof BunkAssignmentsResponseSchema>;
export type BunkAssignmentsDraftRecord = z.infer<typeof BunkAssignmentsDraftRecordSchema>;
export type BunkAssignmentsDraftResponse = z.infer<typeof BunkAssignmentsDraftResponseSchema>;
