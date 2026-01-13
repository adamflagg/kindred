/**
 * Zod schemas for camper-related collections: persons, attendees
 */
import { z } from 'zod';
import {
  BaseSystemFieldsSchema,
  IsoDateStringSchema,
  RecordIdStringSchema,
  AddressSchema,
  PhoneNumberSchema,
  EmailAddressSchema,
  nullableJson,
} from './common';

// Attendee status enum
export const AttendeesStatusSchema = z.enum([
  'enrolled',
  'applied',
  'waitlisted',
  'left_early',
  'cancelled',
  'dismissed',
  'inquiry',
  'withdrawn',
  'incomplete',
  'unknown',
]);

// Persons record schema
export const PersonsRecordSchema = z.object({
  address: nullableJson(AddressSchema),
  age: z.number().optional(),
  birthdate: z.string().optional(),
  cm_id: z.number(),
  email_addresses: nullableJson(z.array(EmailAddressSchema)),
  first_name: z.string(),
  gender: z.string().optional(),
  gender_identity_id: z.number().optional(),
  gender_identity_name: z.string().optional(),
  gender_identity_write_in: z.string().optional(),
  gender_pronoun_id: z.number().optional(),
  gender_pronoun_name: z.string().optional(),
  gender_pronoun_write_in: z.string().optional(),
  grade: z.number().nullable().optional(),
  household_id: z.number().optional(),
  is_camper: z.boolean().optional(),
  last_name: z.string(),
  last_year_attended: z.number().optional(),
  phone_numbers: nullableJson(z.array(PhoneNumberSchema)),
  preferred_name: z.string().optional(),
  raw_data: nullableJson(z.record(z.string(), z.unknown())),
  school: z.string().optional(),
  year: z.number(),
  years_at_camp: z.number().optional(),
});

// Full persons response (with system fields)
export const PersonsResponseSchema = PersonsRecordSchema.merge(BaseSystemFieldsSchema);

// Attendees record schema
export const AttendeesRecordSchema = z.object({
  enrollment_date: IsoDateStringSchema.optional(),
  is_active: z.boolean().optional(),
  person: RecordIdStringSchema.optional(),
  person_id: z.number(),
  session: RecordIdStringSchema,
  status: AttendeesStatusSchema.optional(),
  status_id: z.number().optional(),
  year: z.number(),
});

// Full attendees response (with system fields)
export const AttendeesResponseSchema = AttendeesRecordSchema.merge(BaseSystemFieldsSchema);

// Export types
export type AttendeesStatus = z.infer<typeof AttendeesStatusSchema>;
export type PersonsRecord = z.infer<typeof PersonsRecordSchema>;
export type PersonsResponse = z.infer<typeof PersonsResponseSchema>;
export type AttendeesRecord = z.infer<typeof AttendeesRecordSchema>;
export type AttendeesResponse = z.infer<typeof AttendeesResponseSchema>;
