/**
 * Safe query utilities for runtime validation of API responses
 *
 * These utilities integrate Zod schemas with React Query to catch
 * API contract violations at runtime, providing better error messages
 * than TypeScript alone (which only checks at compile time).
 */
import { z } from 'zod';

/**
 * Parse an API response with a Zod schema, throwing on validation failure.
 *
 * Use this when you want to fail fast on invalid data.
 *
 * @example
 * const person = parseResponse(PersonsResponseSchema, apiData);
 */
export function parseResponse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safely parse an API response with a Zod schema.
 *
 * Returns the parsed data on success, or logs the error and returns undefined.
 * Use this when you want graceful degradation instead of throwing.
 *
 * @example
 * const person = safeParseResponse(PersonsResponseSchema, apiData);
 * if (!person) {
 *   // Handle missing data gracefully
 * }
 */
export function safeParseResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T | undefined {
  const result = schema.safeParse(data);

  if (!result.success) {
    console.error(
      `API response validation failed${context ? ` (${context})` : ''}:`,
      result.error.format()
    );
    return undefined;
  }

  return result.data;
}

/**
 * Parse an array of API responses with a Zod schema.
 *
 * Returns successfully parsed items, logging any that fail validation.
 * Useful for list endpoints where some records may have invalid data.
 *
 * @example
 * const persons = parseArrayResponse(PersonsResponseSchema, apiData.items);
 */
export function parseArrayResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown[],
  context?: string
): T[] {
  const results: T[] = [];
  let errorCount = 0;

  for (let i = 0; i < data.length; i++) {
    const result = schema.safeParse(data[i]);
    if (result.success) {
      results.push(result.data);
    } else {
      errorCount++;
      if (errorCount <= 3) {
        // Only log first 3 errors to avoid console spam
        console.error(
          `API response validation failed for item ${i}${context ? ` (${context})` : ''}:`,
          result.error.format()
        );
      }
    }
  }

  if (errorCount > 3) {
    console.error(
      `... and ${errorCount - 3} more validation errors${context ? ` (${context})` : ''}`
    );
  }

  return results;
}

/**
 * Create a validated query function wrapper.
 *
 * Wraps an async query function to validate its result with a Zod schema.
 * Useful for integrating with React Query's queryFn.
 *
 * @example
 * const queryFn = validatedQueryFn(
 *   PersonsResponseSchema,
 *   async () => pb.collection('persons').getOne(id)
 * );
 */
export function validatedQueryFn<T>(
  schema: z.ZodSchema<T>,
  queryFn: () => Promise<unknown>
): () => Promise<T> {
  return async () => {
    const data = await queryFn();
    return schema.parse(data);
  };
}

/**
 * Create a validated list query function wrapper.
 *
 * Similar to validatedQueryFn but for list endpoints that return { items: T[] }.
 * Parses each item individually and filters out invalid ones.
 *
 * @example
 * const queryFn = validatedListQueryFn(
 *   PersonsResponseSchema,
 *   async () => pb.collection('persons').getFullList()
 * );
 */
export function validatedListQueryFn<T>(
  schema: z.ZodSchema<T>,
  queryFn: () => Promise<unknown[]>,
  context?: string
): () => Promise<T[]> {
  return async () => {
    const data = await queryFn();
    return parseArrayResponse(schema, data, context);
  };
}
