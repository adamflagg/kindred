# CampMinder API Reference

This directory contains OpenAPI 3.0 specification files from CampMinder's developer documentation. These schema files define the available endpoints, request/response structures, and authentication requirements for integrating with CampMinder's REST API.

## Sample Data Notes

The example files use anonymized data for privacy:
- **Names**: Based on popular sci-fi/fantasy characters (Star Wars, LOTR, Marvel, etc.)
- **Ages**: Realistic camp demographics (8-17 years old)
- **IDs**: Consistent fake IDs across all examples
- **Dates**: Current season (2025) with realistic camp schedules

## Integration Flow

1. **Auth** → Obtain JWT tokens
2. **Sessions** → Discover available camp sessions
3. **Persons** → Access camper profiles and bunking requests
4. **Divisions** → Understand age groupings
5. **Bunks** → Manage cabin assignments

## API Files

- **`auth.yaml`** - Authentication endpoints for JWT token generation
- **`sessions.yaml`** - Camp session management and attendee endpoints
- **`persons.yaml`** - Camper and person data endpoints (includes limited write access)
- **`bunks.yaml`** - Bunk, bunk plan, and bunk assignment endpoints
- **`divisions.yaml`** - Division and division attendee endpoints
- **`staff.yaml`** - Staff management endpoints

## Authentication

- **Endpoint**: GET `/auth/apikey`
- **Base URL**: `https://api.campminder.com/auth`
- **Required Headers**:
  - `Authorization`: API Key (entire value, no bearer prefix)
  - `X-Request-ID` (optional): For troubleshooting
- **Response**: 
  - `Token`: JWT token for subsequent requests
  - `ClientIDs`: Comma-separated list of client IDs

### Authentication Flow
1. Call `/auth/apikey` with API key to get JWT
2. Use JWT as Bearer token for all subsequent requests
3. JWT is short-lived, regenerate as needed

## Sessions API
**Base URL**: `https://api.campminder.com/sessions`

### List Sessions
- **Endpoint**: GET `/`
- **Required Parameters**:
  - `clientid` (query): Camp ID (e.g., 754)
  - `seasonid` (query): Season year (e.g., 2024)
  - `pagenumber` (query): Min 1
  - `pagesize` (query): 1-1000
- **Required Headers**:
  - `Authorization`: Bearer {JWT_TOKEN}
- **Response Structure**:
  - `TotalCount`: Total records
  - `Next`: Link to next page
  - `Results`: Array of SessionResponse objects

### Get Session Attendees
- **Endpoint**: GET `/{id}/season/{seasonid}/attendees`
- **Required Parameters**:
  - `id` (path): Session ID
  - `seasonid` (path): Season ID
  - `clientid` (query): Camp ID
- **Optional Parameters**:
  - `programid` (query)
  - `status` (query): 2=Enrolled, 4=Applied, 8=WaitList, etc.
  - `lastupdated` (query): RFC3339 datetime
  - `postdate` (query): RFC3339 datetime
- **Response Structure**:
  - `ClientID`
  - `SessionID`
  - `ProgramID`
  - `SeasonID`
  - `PersonsStatus`: Array of person status objects

### List All Attendees
- **Endpoint**: GET `/attendees`
- **Required Parameters**:
  - `clientid` (query)
  - `seasonid` (query)
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `sessionids` (query): Array of session IDs
  - `programids` (query): Array of program IDs
  - `status` (query): Attendee status
  - `personids` (query): Array of person IDs
  - `lastupdated` (query)
  - `postdate` (query)
- **Response Structure**:
  - `TotalCount`
  - `Next`
  - `Results`: Array of AttendeeResponse objects

## Bunks API
**Base URL**: `https://api.campminder.com/bunks`

### List Bunks
- **Endpoint**: GET `/`
- **Required Parameters**:
  - `clientid` (query)
  - `seasonid` (query)
  - `orderascending` (query): true/false
  - `orderby` (query): "Name" or "SortOrder"
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `includeinactive` (query): Include inactive bunks
- **Response Structure**:
  - `TotalCount`
  - `Next`
  - `Results`: Array of BunkResponse objects

### List Bunk Plans
- **Endpoint**: GET `/plans`
- **Required Parameters**:
  - `clientid` (query)
  - `seasonid` (query)
  - `orderascending` (query)
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `orderby` (query): "Name" (defaults to "SortOrder")
  - `includeinactive` (query)
- **Response Structure**:
  - `TotalCount`
  - `Next`
  - `Results`: Array of BunkPlanResponse objects

### List Bunk Assignments
- **Endpoint**: GET `/assignments`
- **Required Parameters**:
  - `clientid` (query)
  - `seasonid` (query)
  - `bunkplanids` (query): Array of bunk plan IDs
  - `bunkids` (query): Array of bunk IDs
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `lastupdated` (query): RFC3339 datetime
  - `includedeleted` (query): Include deleted assignments
- **Response Structure**:
  - `TotalCount`
  - `Next`
  - `Results`: Array of AssignmentsResponse objects

## Persons API
**Base URL**: `https://api.campminder.com/persons`

### List Persons
- **Endpoint**: GET `/`
- **Required Parameters**:
  - `clientid` (query)
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `genderid` (query): 0=Female, 1=Male, 3=Undefined
  - `id` (query): Array of person IDs
  - `includecontactdetails` (query)
  - `includerelatives` (query)
  - `includefamilypersons` (query)
  - `includecamperdetails` (query)
  - `email` (query): Array of email addresses
  - `seasonid` (query): Defaults to current season
  - `lastupdated` (query): RFC3339 datetime
  - `includedeleted` (query)
  - `includehouseholddetails` (query)
  - `includetags` (query)
  - `tags` (query): Array of tag names
- **Response Structure**:
  - `TotalCount`
  - `Next`
  - `Results`: Array of PersonResponse objects

### Get Person by ID
- **Endpoint**: GET `/{personid}`
- **Required Parameters**:
  - `personid` (path)
- **Optional Parameters**:
  - `clientid` (query)

### Patch Person (Limited Write Access)
- **Endpoint**: PATCH `/{personid}`
- **Required Parameters**:
  - `personid` (path)
- **Request Body**:
  - `PersonID`
  - `ClientID`
  - `ExternalID`: Only field that can be updated (50 char limit)
- **Note**: This is the ONLY write endpoint in the API

## Divisions API
**Base URL**: `https://api.campminder.com/divisions`

### List Divisions
- **Endpoint**: GET `/`
- **Required Parameters**:
  - `clientid` (query)
  - `pagenumber` (query)
  - `pagesize` (query)

### List Division Attendees
- **Endpoint**: GET `/{id}/attendees`
- **Required Parameters**:
  - `id` (path): Division ID
  - `seasonid` (query)
  - `clientid` (query)

### List All Division Attendees
- **Endpoint**: GET `/attendees`
- **Required Parameters**:
  - `clientid` (query)
  - `seasonid` (query)
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `personids` (query): Array
  - `divisionids` (query): Array

## Staff API
**Base URL**: `https://api.campminder.com/staff`

### List Staff
- **Endpoint**: GET `/`
- **Required Parameters**:
  - `seasonid` (query)
  - `status` (query): 1=Active, 2=Resigned, 3=Dismissed, 4=Cancelled
  - `pagenumber` (query)
  - `pagesize` (query)
- **Optional Parameters**:
  - `clientid` (query)
  - `organizationalcategories` (query): Array
  - `positions` (query): Array
  - `programareas` (query): Array
  - `lastupdated` (query)
  - `divisionids` (query): Array
  - `personids` (query): Array

## Key Response Field Names
All list endpoints follow this pattern:
- `TotalCount`: Total number of records
- `Next`: URL for next page of results
- `Results`: Array of response objects

## Important Notes

### Missing Endpoints
The API does NOT provide endpoints for:
- GET `/sessions/{id}/bunkplans` - This endpoint doesn't exist
- Any endpoint to retrieve bunking requests/preferences
- Write access to update bunk assignments
- Write access to sessions, bunks, or divisions

### Pagination
- All list endpoints require `pagenumber` (min 1) and `pagesize` (1-1000)
- Use `Next` field in response for pagination URL

### Date/Time Formats
- Dates: ISO8601 format (YYYY-MM-DD)
- DateTimes: RFC3339 format (e.g., 2023-01-17T21:45:43.8792Z)

### Rate Limiting
- Implement 0.5s delay between API calls to avoid 429 errors

### Security Schemes
All endpoints (except auth) support:
- `apiKeyHeader`: Ocp-Apim-Subscription-Key
- `apiKeyQuery`: subscription-key
- `jwtBearerAuth`: Bearer token (recommended)