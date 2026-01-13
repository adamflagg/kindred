/**
 * Utility functions for formatting PocketBase filter expressions.
 * PocketBase requires spaces around operators for proper parsing.
 */

/**
 * Format a PocketBase filter string to ensure proper spacing around operators.
 * 
 * @param filter - The filter string to format
 * @returns The formatted filter string with proper spacing
 * 
 * @example
 * formatFilter('session_type!="family"') // Returns: 'session_type != "family"'
 * formatFilter('year=2025&&status="active"') // Returns: 'year = 2025 && status = "active"'
 */
export function formatFilter(filter: string): string {
  if (!filter) return filter;
  
  // Add spaces around comparison operators
  const formatted = filter
    // Handle != operator specifically
    .replace(/!=(?=\S)/g, ' != ')
    .replace(/(?<=\S)!=/g, ' != ')
    // Handle other operators
    .replace(/==(?=\S)/g, ' == ')
    .replace(/(?<=\S)==/g, ' == ')
    .replace(/<=(?=\S)/g, ' <= ')
    .replace(/(?<=\S)<=/g, ' <= ')
    .replace(/>=(?=\S)/g, ' >= ')
    .replace(/(?<=\S)>=/g, ' >= ')
    .replace(/<(?=\S)(?!=)/g, ' < ')
    .replace(/(?<=\S)(?<!<|>|!|=)</g, ' < ')
    .replace(/>(?=\S)(?!=)/g, ' > ')
    .replace(/(?<=\S)(?<!<|>|!|=)>/g, ' > ')
    .replace(/=(?=\S)(?!=)/g, ' = ')
    .replace(/(?<=\S)(?<![!<>=])=/g, ' = ')
    // Handle logical operators
    .replace(/&&/g, ' && ')
    .replace(/\|\|/g, ' || ')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  return formatted;
}

/**
 * Build a PocketBase filter from an array of conditions.
 * Automatically formats the filter with proper spacing.
 * 
 * @param conditions - Array of filter conditions
 * @param operator - Logical operator to join conditions ('&&' or '||')
 * @returns The formatted filter string
 * 
 * @example
 * buildFilter(['session_type = "main"', 'year = 2025']) 
 * // Returns: 'session_type = "main" && year = 2025'
 */
export function buildFilter(conditions: string[], operator: '&&' | '||' = '&&'): string {
  if (!conditions || conditions.length === 0) return '';
  
  // Format each condition and join with operator
  const formatted = conditions
    .filter(c => c && c.trim())
    .map(c => formatFilter(c))
    .join(` ${operator} `);
  
  // Wrap in parentheses if multiple conditions
  return conditions.length > 1 ? `(${formatted})` : formatted;
}

/**
 * Create a filter for excluding specific values.
 * 
 * @param field - The field name
 * @param values - Array of values to exclude
 * @returns The formatted exclusion filter
 * 
 * @example
 * createExclusionFilter('session_type', ['family', 'taste'])
 * // Returns: '(session_type != "family" && session_type != "taste")'
 */
export function createExclusionFilter(field: string, values: string[]): string {
  const conditions = values.map(value => `${field} != "${value}"`);
  return buildFilter(conditions, '&&');
}

/**
 * Create a filter for including specific values.
 * 
 * @param field - The field name
 * @param values - Array of values to include
 * @returns The formatted inclusion filter
 * 
 * @example
 * createInclusionFilter('session_type', ['main', 'taste'])
 * // Returns: '(session_type = "main" || session_type = "taste")'
 */
export function createInclusionFilter(field: string, values: string[]): string {
  const conditions = values.map(value => `${field} = "${value}"`);
  return buildFilter(conditions, '||');
}