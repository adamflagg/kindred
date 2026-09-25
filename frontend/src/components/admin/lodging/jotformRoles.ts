/**
 * The Jotform field-mapping roles (kindred#2759), in the order the mapping
 * selects render. Keys are the API's `field_map` roles; values are what staff
 * read. Kept out of `JotformFormCard.tsx` so that file exports only components
 * (react-refresh).
 */
export const JOTFORM_ROLE_LABELS: Readonly<Record<string, string>> = {
  first_name: 'First name',
  last_name: 'Last name',
  nametag_name: 'Nametag',
  respondent_email: 'Respondent email',
  bunking_request: 'Bunking request',
  coming_with: 'Coming with',
  emergency_name: 'Emergency contact name',
  emergency_phone: 'Emergency contact phone',
  emergency_email: 'Emergency contact email',
  housing_accommodation: 'Housing accommodation (Yes/No)',
  accommodation_details: 'Accommodation details',
  cpap: 'CPAP',
}
