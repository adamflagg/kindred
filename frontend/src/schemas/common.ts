/**
 * Common Zod schemas for shared types and base fields
 */
import { z } from 'zod';

// Base primitive schemas
export const IsoDateStringSchema = z.string();
export const RecordIdStringSchema = z.string();

// PocketBase base system fields (present on all records)
export const BaseSystemFieldsSchema = z.object({
  id: RecordIdStringSchema,
  collectionId: z.string(),
  collectionName: z.string(),
  created: IsoDateStringSchema.optional(),
  updated: IsoDateStringSchema.optional(),
});

// Auth system fields (for authenticated collections)
export const AuthSystemFieldsSchema = BaseSystemFieldsSchema.extend({
  email: z.string().email(),
  emailVisibility: z.boolean(),
  username: z.string(),
  verified: z.boolean(),
});

// Helper for nullable JSON fields
export const nullableJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.null()]).optional();

// Address schema (nested in persons)
export const AddressSchema = z.object({
  street1: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
}).passthrough();

// Phone number schema
export const PhoneNumberSchema = z.object({
  type: z.string().optional(),
  number: z.string(),
}).passthrough();

// Email schema
export const EmailAddressSchema = z.object({
  type: z.string().optional(),
  email: z.string().email(),
}).passthrough();

// Export types inferred from schemas
export type IsoDateString = z.infer<typeof IsoDateStringSchema>;
export type RecordIdString = z.infer<typeof RecordIdStringSchema>;
export type BaseSystemFields = z.infer<typeof BaseSystemFieldsSchema>;
export type AuthSystemFields = z.infer<typeof AuthSystemFieldsSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;
export type EmailAddress = z.infer<typeof EmailAddressSchema>;
