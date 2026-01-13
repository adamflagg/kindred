/**
 * Zod schemas for request-related collections: bunk_requests, original_bunk_requests
 */
import { z } from 'zod';
import {
  BaseSystemFieldsSchema,
  IsoDateStringSchema,
  RecordIdStringSchema,
  nullableJson,
} from './common';

// Bunk request type enum
export const BunkRequestsRequestTypeSchema = z.enum([
  'bunk_with',
  'not_bunk_with',
  'age_preference',
]);

// Bunk request status enum
export const BunkRequestsStatusSchema = z.enum([
  'resolved',
  'pending',
  'declined',
]);

// Bunk request source enum
export const BunkRequestsSourceSchema = z.enum([
  'family',
  'staff',
  'notes',
]);

// Bunk requests record schema
export const BunkRequestsRecordSchema = z.object({
  age_preference_target: z.string().optional(),
  ai_p1_reasoning: nullableJson(z.record(z.string(), z.unknown())),
  ai_p3_reasoning: nullableJson(z.record(z.string(), z.unknown())),
  ai_parsed: z.boolean().optional(),
  can_be_dropped: z.boolean().optional(),
  confidence_explanation: nullableJson(z.record(z.string(), z.unknown())),
  confidence_level: z.string().optional(),
  confidence_score: z.number().optional(),
  conflict_group_id: z.string().optional(),
  csv_position: z.number().optional(),
  is_active: z.boolean().optional(),
  is_placeholder: z.boolean().optional(),
  is_reciprocal: z.boolean().optional(),
  keywords_found: nullableJson(z.array(z.string())),
  manual_review_reason: z.string().optional(),
  metadata: nullableJson(z.record(z.string(), z.unknown())),
  original_text: z.string().optional(),
  parse_notes: z.string().optional(),
  priority: z.number().optional(),
  request_locked: z.boolean().optional(),
  request_type: BunkRequestsRequestTypeSchema,
  requestee_id: z.number().optional(),
  requested_person_name: z.string().optional(),
  requester_id: z.number(),
  requires_family_decision: z.boolean().optional(),
  requires_manual_review: z.boolean().optional(),
  resolution_notes: z.string().optional(),
  session_id: z.number(),
  source: BunkRequestsSourceSchema.optional(),
  source_detail: z.string().optional(),
  source_field: z.string().optional(),
  status: BunkRequestsStatusSchema,
  was_dropped_for_spread: z.boolean().optional(),
  year: z.number(),
});

// Full bunk requests response (with system fields)
export const BunkRequestsResponseSchema = BunkRequestsRecordSchema.merge(BaseSystemFieldsSchema);

// Original bunk requests field enum
export const OriginalBunkRequestsFieldSchema = z.enum([
  'bunk_with',
  'not_bunk_with',
  'bunking_notes',
  'internal_notes',
  'socialize_with',
]);

// Original bunk requests record schema
export const OriginalBunkRequestsRecordSchema = z.object({
  content: z.string(),
  field: OriginalBunkRequestsFieldSchema,
  processed: IsoDateStringSchema.optional(),
  requester: RecordIdStringSchema,
  year: z.number(),
});

// Full original bunk requests response (with system fields)
export const OriginalBunkRequestsResponseSchema = OriginalBunkRequestsRecordSchema.merge(BaseSystemFieldsSchema);

// Export types
export type BunkRequestsRequestType = z.infer<typeof BunkRequestsRequestTypeSchema>;
export type BunkRequestsStatus = z.infer<typeof BunkRequestsStatusSchema>;
export type BunkRequestsSource = z.infer<typeof BunkRequestsSourceSchema>;
export type BunkRequestsRecord = z.infer<typeof BunkRequestsRecordSchema>;
export type BunkRequestsResponse = z.infer<typeof BunkRequestsResponseSchema>;
export type OriginalBunkRequestsField = z.infer<typeof OriginalBunkRequestsFieldSchema>;
export type OriginalBunkRequestsRecord = z.infer<typeof OriginalBunkRequestsRecordSchema>;
export type OriginalBunkRequestsResponse = z.infer<typeof OriginalBunkRequestsResponseSchema>;
