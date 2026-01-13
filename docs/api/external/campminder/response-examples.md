# CampMinder API Response Examples

This document provides actual response examples from the CampMinder API for each endpoint used in our sync scripts. These examples help with understanding data structure and writing scripts that chain tables together.

## Table of Contents

1. [Authentication API](#authentication-api)
2. [Persons API](#persons-api)
3. [Sessions API](#sessions-api)
4. [Divisions API](#divisions-api)
5. [Bunks API](#bunks-api)
6. [Session Attendees API](#session-attendees-api)
7. [Bunk Plans API](#bunk-plans-api)
8. [Bunk Assignments API](#bunk-assignments-api)
9. [Family Persons API](#family-persons-api)
10. [Relatives API](#relatives-api)
11. [Tags API](#tags-api)

## Authentication API

### Endpoint: `GET /auth/apikey`

**Base URL**: `https://api.campminder.com/auth`

**Headers:**
```
Authorization: {API_KEY_VALUE}
```

**Response Example:**
```json
{
  "Token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MDA2ODk4MTYsImp0aSI6IjRkMzI4MTUyLWU2NDEtNDgwNS1hMDE5LTlhYTEzMjdhZGRiOSIsImlhdCI6MTcwMDY4NjIxNiwibmJmIjoxNzAwNjg2MjE2LCJzdWIiOiI3fHNlcnZpY2VhY2NvdW50IiwicGVyc29uSUQiOiIiLCJjbGllbnRJRCI6IiIsInJvbGVzIjpbImlkZW50aXR5aWQuNyIsImlkZW50aXR5dHlwZS5zZXJ2aWNlYWNjb3VudCIsImNsaWVudC43NTQiLCJwZXJzb24uKiIsImNsaWVudC5hcHBsaWNhdGlvbiIsInMucGVyIiwicy5ibmsiLCJzLmRpdiIsInMuc3RmIiwicy5zZXMiXSwib3JpZ2luIjoic2VydmljZSIsImRldmljZUlEIjoiZGE4MGIwMGEtNmEzOC00N2YxLTgwNjEtMGY0NjY0NDRiZmUyIn0.BLrYmna53ciqT84TU_IZLRhxTvUZfwYamYhEz2LSdn479zWfFdpkosUYtnNxjtCBuZ80UH-gusqwRkdNtKTrz5GQ2xivanmGyQP26ge04ps7-qMJldVeueI1MZAz1L9bxIaZEl9TQA30I6L4WI9cY_gDbjIuwI16PsNjypz4oqeEB9tUez-VWeYg0xHAJkGYqxgBIFQn54u-h2q7MpcAObmxnvp0IuuSQ0fGbb9zsz9_GAE_Zk7UpCAD_lRM4ooSQK-bvDMrNAiOvjcUBnVBb4JvmOTaJAdyV7Nbx9i_obq065PMr_uIR4vVTHKkIbbcA65WjuN4b5_2iVf73ypJbPRQQClcV1qNuSVJhdMfvLTdIA2oC1FSNgkBGgphKpovauKEDU-7SliAW9tZoeMn0GmSD9TOPGMRly1f3rN6Mop9PTc-h7AW3aQGLNNNpZ583Pa-P_fohSnAOIP3lTkrP9Aoy6P8L4hUw_mdLtvVI-mLQO0dOH7kR8GvvF1PFUe6GDP834YkSSRg1lLS4SMz0AWgAQLI-2EEFF10gmhuC1zXZsJGQ-OU8z-mdrLAnlA6q1id0__0LsOvNLiI_REj9zl00Eh3RdyQhcqdrKdS2BXue4lyWTWSXNYVteBNP9bQh4NZ1k8VKueUA7sZ-VnsbGlzDpZQocpwdCr1lBjwkks",
  "ClientIDs": "123,456,789"
}
```

**JWT Token Details:**
- **Algorithm**: RS256
- **Token Type**: JWT
- **Expiration**: Typically 1 hour from issue time
- **Claims**:
  - `exp`: Expiration timestamp
  - `jti`: JWT ID
  - `iat`: Issued at timestamp
  - `nbf`: Not before timestamp
  - `sub`: Subject (e.g., "7|serviceaccount")
  - `personID`: Empty for service accounts
  - `clientID`: Empty for service accounts
  - `roles`: Array of permissions (e.g., ["identity.7", "client.754", "person.*", "s.per", "s.bnk", "s.div", "s.stf", "s.ses"])
  - `origin`: "service"
  - `deviceID`: Unique device identifier

**Usage Notes:**
- Use the `Token` value as a Bearer token for all subsequent API requests
- Tokens expire after ~1 hour, requiring re-authentication
- The `ClientIDs` field contains comma-separated client IDs this API key has access to
- Service account tokens have empty `personID` and `clientID` fields in the JWT claims

## Persons API

### Endpoint: `GET /persons`

**Parameters:**
```json
{
    "clientid": 754,
    "pagenumber": 1,
    "pagesize": 50,
    "includecamperdetails": "true",
    "includecontactdetails": "true",
    "includetags": "true",
    "includerelatives": "true",
    "includefamilypersons": "true",
    "includehouseholddetails": "true"
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ID": 333,
      "ClientID": 754,
      "Name": {
        "First": "MyName",
        "Last": "MySecondName",
        "Preferred": "MyNickName"
      },
      "Relatives": [
        {
          "IsWard": true,
          "IsGuardian": true,
          "ID": 0,
          "IsPrimary": true
        }
      ],
      "ContactDetails": {
        "PhoneNumbers": [
          {
            "Type": "Mobile",
            "Location": "Home",
            "Original": "(720)555-1234",
            "Number": "7205551234"
          }
        ],
        "Emails": [
          {
            "Address": "thisisanemailaddress@mailinator.com",
            "IsLogin": true
          }
        ]
      },
      "FamilyPersons": [
        {
          "FamilyID": 3862806,
          "PersonID": 1258963,
          "RoleID": 3,
          "RoleName": "Primary Child"
        }
      ],
      "CamperDetails": {
        "PartitionID": 0,
        "CampGradeID": 0,
        "School": "Nuevo Vista School",
        "CampGradeName": "7th",
        "SchoolGradeID": 8,
        "SchoolGradeName": "Eighth",
        "YearsAtCamp": 2,
        "LastYearAttended": 2019,
        "LeadDate": "2016-12-29",
        "TShirtSize": "Child small",
        "DivisionID": 2,
        "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
      },
      "DateOfBirth": "2005-02-02",
      "Age": 14.1,
      "MaritalStatus": "Married",
      "GenderID": 0,
      "GenderName": "female",
      "GenderPronounID": 0,
      "GenderPronounName": "string",
      "GenderPronounWriteIn": "string",
      "GenderIdentityID": 0,
      "GenderIdentityName": "string",
      "GenderIdentityWriteIn": "string",
      "ExternalID": "string",
      "Households": {
        "PrincipalHousehold": {
          "ID": 123856,
          "ClientID": 248,
          "Greeting": "Hunter and Ashely",
          "MailingTitle": "Mr. and Mrs Hunter Doe",
          "AlternateMailingTitle": "The Doe Family",
          "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
          "HouseholdPhone": "212-523-5555",
          "BillingAddress": {
            "Address1": "123 adress 1",
            "Address2": "apt 1",
            "City": "Boulder",
            "StateProvince": "CO",
            "PostalCode": "80303",
            "Country": "US",
            "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
          },
          "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
        },
        "PrimaryChildhoodHousehold": {
          "ID": 123856,
          "ClientID": 248,
          "Greeting": "Hunter and Ashely",
          "MailingTitle": "Mr. and Mrs Hunter Doe",
          "AlternateMailingTitle": "The Doe Family",
          "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
          "HouseholdPhone": "212-523-5555",
          "BillingAddress": {
            "Address1": "123 adress 1",
            "Address2": "apt 1",
            "City": "Boulder",
            "StateProvince": "CO",
            "PostalCode": "80303",
            "Country": "US",
            "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
          },
          "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
        },
        "AlternateChildhoodHousehold": {
          "ID": 123856,
          "ClientID": 248,
          "Greeting": "Hunter and Ashely",
          "MailingTitle": "Mr. and Mrs Hunter Doe",
          "AlternateMailingTitle": "The Doe Family",
          "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
          "HouseholdPhone": "212-523-5555",
          "BillingAddress": {
            "Address1": "123 adress 1",
            "Address2": "apt 1",
            "City": "Boulder",
            "StateProvince": "CO",
            "PostalCode": "80303",
            "Country": "US",
            "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
          },
          "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
        }
      },
      "PrimaryMailingAddress": {
        "Address1": "123 adress 1",
        "Address2": "apt 1",
        "City": "Boulder",
        "StateProvince": "CO",
        "PostalCode": "80303",
        "Country": "US",
        "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
      },
      "IsDeceased": false,
      "LastUpdatedUTC": "2023-02-22T02:58:44.9800Z",
      "IsDeleted": false,
      "Tags": [
        {
          "Name": "string",
          "IsSeasonal": true,
          "LastUpdatedUTC": "string"
        }
      ]
    }
  ]
}
```

### Endpoint: `GET /persons/{personid}`

**Parameters:**
```json
{
    "personid": 333
}
```

**Response Example:**
```json
{
  "ID": 333,
  "ClientID": 754,
  "Name": {
    "First": "MyName",
    "Last": "MySecondName",
    "Preferred": "MyNickName"
  },
  "Relatives": [
    {
      "IsWard": true,
      "IsGuardian": true,
      "ID": 0,
      "IsPrimary": true
    }
  ],
  "ContactDetails": {
    "PhoneNumbers": [
      {
        "Type": "Mobile",
        "Location": "Home",
        "Original": "(720)555-1234",
        "Number": "7205551234"
      }
    ],
    "Emails": [
      {
        "Address": "thisisanemailaddress@mailinator.com",
        "IsLogin": true
      }
    ]
  },
  "FamilyPersons": [
    {
      "FamilyID": 3862806,
      "PersonID": 1258963,
      "RoleID": 3,
      "RoleName": "Primary Child"
    }
  ],
  "CamperDetails": {
    "PartitionID": 0,
    "CampGradeID": 0,
    "School": "Nuevo Vista School",
    "CampGradeName": "7th",
    "SchoolGradeID": 8,
    "SchoolGradeName": "Eighth",
    "YearsAtCamp": 2,
    "LastYearAttended": 2019,
    "LeadDate": "2016-12-29",
    "TShirtSize": "Child small",
    "DivisionID": 2,
    "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
  },
  "DateOfBirth": "2005-02-02",
  "Age": 14.1,
  "MaritalStatus": "Married",
  "GenderID": 0,
  "GenderName": "female",
  "GenderPronounID": 0,
  "GenderPronounName": "string",
  "GenderPronounWriteIn": "string",
  "GenderIdentityID": 0,
  "GenderIdentityName": "string",
  "GenderIdentityWriteIn": "string",
  "ExternalID": "string",
  "Households": {
    "PrincipalHousehold": {
      "ID": 123856,
      "ClientID": 248,
      "Greeting": "Hunter and Ashely",
      "MailingTitle": "Mr. and Mrs Hunter Doe",
      "AlternateMailingTitle": "The Doe Family",
      "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
      "HouseholdPhone": "212-523-5555",
      "BillingAddress": {
        "Address1": "123 adress 1",
        "Address2": "apt 1",
        "City": "Boulder",
        "StateProvince": "CO",
        "PostalCode": "80303",
        "Country": "US",
        "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
      },
      "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
    },
    "PrimaryChildhoodHousehold": {
      "ID": 123856,
      "ClientID": 248,
      "Greeting": "Hunter and Ashely",
      "MailingTitle": "Mr. and Mrs Hunter Doe",
      "AlternateMailingTitle": "The Doe Family",
      "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
      "HouseholdPhone": "212-523-5555",
      "BillingAddress": {
        "Address1": "123 adress 1",
        "Address2": "apt 1",
        "City": "Boulder",
        "StateProvince": "CO",
        "PostalCode": "80303",
        "Country": "US",
        "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
      },
      "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
    },
    "AlternateChildhoodHousehold": {
      "ID": 123856,
      "ClientID": 248,
      "Greeting": "Hunter and Ashely",
      "MailingTitle": "Mr. and Mrs Hunter Doe",
      "AlternateMailingTitle": "The Doe Family",
      "BillingMailingTitle": "Mr. and Mrs Hunter Doe",
      "HouseholdPhone": "212-523-5555",
      "BillingAddress": {
        "Address1": "123 adress 1",
        "Address2": "apt 1",
        "City": "Boulder",
        "StateProvince": "CO",
        "PostalCode": "80303",
        "Country": "US",
        "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
      },
      "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
    }
  },
  "PrimaryMailingAddress": {
    "Address1": "123 adress 1",
    "Address2": "apt 1",
    "City": "Boulder",
    "StateProvince": "CO",
    "PostalCode": "80303",
    "Country": "US",
    "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
  },
  "IsDeceased": false,
  "LastUpdatedUTC": "2023-02-22T02:58:44.9800Z",
  "IsDeleted": false,
  "Tags": [
    {
      "Name": "string",
      "IsSeasonal": true,
      "LastUpdatedUTC": "string"
    }
  ]
}
```

### Endpoint: `PATCH /persons/{personid}`

**Parameters:**
```json
{
    "personid": 1
}
```

**Request Body:**
```json
{
  "PersonID": 1,
  "ClientID": 1,
  "ExternalID": "string"
}
```

**cURL Example:**
```bash
curl --request PATCH \
  --url https://api.campminder.com/persons/personid \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --header 'Ocp-Apim-Subscription-Key: 123' \
  --header 'X-Request-ID: {request-id}' \
  --data '{
  "PersonID": 1,
  "ClientID": 1,
  "ExternalID": "string"
}'
```

**Note:** This is the ONLY write endpoint in the CampMinder API. Only the `ExternalID` field can be updated.

### Endpoint: `GET /persons/tags`

**Parameters:**
```json
{
    "clientid": 754,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "Name": "Volunteer",
      "IsSeasonal": true,
      "IsHidden": false,
      "LastUpdatedUTC": "2016-12-29T12:03:28.817Z"
    }
  ]
}
```

### Endpoint: `GET /persons/customfields`

**Parameters:**
```json
{
    "clientid": 754,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "Id": 0,
      "Name": "string",
      "DataType": "string",
      "Partition": "string",
      "IsSeasonal": true,
      "IsArray": true,
      "IsActive": true
    }
  ]
}
```

### Endpoint: `GET /persons/customfields/{id}`

**Response Example:**
```json
{
  "Id": 0,
  "Name": "string",
  "DataType": "string",
  "Partition": "string",
  "IsSeasonal": true,
  "IsArray": true,
  "IsActive": true
}
```

### Endpoint: `GET /persons/{personid}/customfields`

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "Id": 0,
      "ClientID": 0,
      "SeasonID": 0,
      "Value": "string",
      "LastUpdated": "string"
    }
  ]
}
```

### Endpoint: `GET /persons/{personid}/customfields/{fieldid}`

**Response Example:**
```json
{
  "Id": 0,
  "ClientID": 0,
  "SeasonID": 0,
  "Value": "string",
  "LastUpdated": "string"
}
```

### Endpoint: `GET /households/{householdid}/customfields`

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "Id": 0,
      "ClientID": 0,
      "SeasonID": 0,
      "Value": "string",
      "LastUpdated": "string"
    }
  ]
}
```

### Endpoint: `GET /households/{householdid}/customfields/{fieldid}`

**Response Example:**
```json
{
  "Id": 0,
  "ClientID": 0,
  "SeasonID": 0,
  "Value": "string",
  "LastUpdated": "string"
}
```

**Field Notes for Person Response:**
- `ContactDetails`: Different structure than expected
  - Phone numbers have `Original` and `Number` fields
  - Emails have `Address` and `IsLogin` fields
- `CamperDetails`: Contains both camp and school grade information
- `Households`: All three household types can be present
  - `AlternateMailingTitle` and `BillingMailingTitle` fields
  - Address fields use `Address1`/`Address2` instead of `Street1`/`Street2`
- `Tags`: Simpler structure without ID field in list response
- Custom fields are generally empty but structure is provided

## Sessions API

### Endpoint: `GET /sessions`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 2021,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "ID": 123123,
      "Self": "/v1/sessions/123123",
      "Name": "name",
      "Description": "sweet thing",
      "IsActive": true,
      "SortOrder": 42,
      "SeasonID": 2021,
      "GroupID": 123,
      "IsDay": true,
      "IsResidential": true,
      "IsForChilden": true,
      "IsForAdults": true,
      "StartDate": "2016-12-29T12:03:28.817",
      "EndDate": "2017-12-29T12:03:28.817",
      "StartAge": 13.9,
      "EndAge": 14.2,
      "StartGradeID": 6,
      "EndGradeID": 7,
      "GenderID": 1
    }
  ]
}
```

**Field Notes:**
- `Self`: API resource link for this session
- `GroupID`: Session group identifier
- `IsDay`: Whether this is a day camp session
- `IsResidential`: Whether this is a residential/overnight session
- `IsForChilden`: Whether this session is for children
- `IsForAdults`: Whether this session is for adults
- `StartAge`/`EndAge`: Age range in decimal format
- `StartGradeID`/`EndGradeID`: Grade range
- `GenderID`: 0=Female, 1=Male, 2=Co-ed, 3=Undefined

### Endpoint: `GET /sessions/groups`

**Parameters:**
```json
{
    "clientid": 754,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "ID": 123123,
      "Self": "/v1/sessions/group/123123",
      "Name": "name",
      "Description": "sweet thing",
      "IsActive": true,
      "SortOrder": 42
    }
  ]
}
```

### Endpoint: `GET /sessions/programs`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 2021,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "ID": 123123,
      "Self": "/v1/sessions/programs/123123",
      "Name": "Archery",
      "Description": "Shooting arrows",
      "IsActive": true,
      "SortOrder": 42,
      "IsDay": true,
      "IsResidential": true,
      "IsForChilden": true,
      "IsForAdults": true,
      "ProgramSeasons": [
        {
          "ID": 12123,
          "SeasonID": 2021,
          "SessionID": 125458,
          "Description": "Some Program season",
          "StartDate": "2023-01-17T21:45:43.8792Z",
          "EndDate": "2023-01-17T21:45:43.8792Z",
          "StartAge": 14.6,
          "EndAge": 15.6,
          "StartGradeID": 6,
          "EndGradeID": 7,
          "GenderID": "1\""
        }
      ]
    }
  ]
}
```

## Divisions API

### Endpoint: `GET /divisions`

**Parameters:**
```json
{
    "clientid": 754,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ID": 123123,
      "Self": "/v0/divisions/123123",
      "ClientID": 754,
      "Name": "Upper Juniors",
      "Description": "sweet thing",
      "StartGradeRangeID": 1,
      "EndGradeRangeID": 7,
      "AssignDuringCamperEnrollment": true,
      "GenderID": 2,
      "Capacity": 100,
      "SubOfDivisionID": 11,
      "StaffOnly": true
    }
  ]
}
```

**Field Notes:**
- `ID`: Unique division identifier
- `Self`: API resource link for this division
- `ClientID`: The camp/client identifier
- `Name`: Display name of the division
- `Description`: Longer description
- `StartGradeRangeID`: Starting grade level
- `EndGradeRangeID`: Ending grade level
- `AssignDuringCamperEnrollment`: Whether campers can be assigned during enrollment
- `GenderID`: 0=Female, 1=Male, 2=Co-ed, 3=Undefined
- `Capacity`: Maximum number of campers
- `SubOfDivisionID`: Parent division ID if this is a sub-division
- `StaffOnly`: Whether this is a staff-only division

### Endpoint: `GET /divisions/attendees`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 2023,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ID": 123,
      "Self": "/v0/divisions/123/attendees/123",
      "ClientID": 754,
      "SeasonID": 2023,
      "PersonID": 1234,
      "DivisionID": 101
    }
  ]
}
```

### Endpoint: `GET /divisions/{id}/attendees`

**Parameters:**
```json
{
    "id": 123123,
    "seasonid": 2023,
    "clientid": 754
}
```

**Response Example:**
```json
{
  "DivisionID": 123123,
  "SeasonID": 2023,
  "ClientID": 754,
  "PersonIDs": [
    0
  ]
}
```

**Field Notes:**
- `DivisionID`: The division being queried
- `SeasonID`: The season/year
- `ClientID`: The camp/client identifier
- `PersonIDs`: Array of person IDs assigned to this division

## Bunks API

### Endpoint: `GET /bunks`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 42,
    "orderascending": true,
    "orderby": "Name",
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "ID": 1558636,
      "Name": "Apache",
      "Code": "APAC",
      "IsActive": true,
      "SortOrder": 2,
      "AreaID": 2
    }
  ]
}
```

**Field Notes:**
- `ClientID`: The camp/client identifier
- `ID`: Unique bunk identifier
- `Name`: Display name of the bunk
- `Code`: Short code for the bunk
- `IsActive`: Whether the bunk is currently active
- `SortOrder`: Display order
- `AreaID`: Physical area/location identifier

## Session Attendees API

### Endpoint: `GET /sessions/attendees`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 2022,
    "pagenumber": 1,
    "pagesize": 500
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 0,
      "PersonID": 158966,
      "SeasonID": 2022,
      "SessionProgramStatus": [
        {
          "SessionID": 123123,
          "ProgramID": 123123,
          "StatusID": 2,
          "StatusName": "Enrolled",
          "Memo": "first session",
          "PostDate": "2",
          "EffectiveDate": "2",
          "LastUpdatedUTC": "2"
        }
      ]
    }
  ]
}
```

**Field Notes:**
- `SessionProgramStatus`: Array of session/program enrollments for this person
  - `StatusID`: 2=Enrolled, 4=Applied, 8=WaitList
  - `Memo`: Additional notes about the enrollment
  - `PostDate`: When the status was posted
  - `EffectiveDate`: When the status becomes effective
  - `LastUpdatedUTC`: Last modification timestamp

### Endpoint: `GET /sessions/{id}/season/{seasonid}/attendees`

**Parameters:**
```json
{
    "id": 123123,
    "seasonid": 2012,
    "clientid": 754
}
```

**Response Example:**
```json
{
  "ClientID": 754,
  "SessionID": 123123,
  "ProgramID": 123123,
  "SeasonID": 2012,
  "PersonsStatus": [
    {
      "PersonID": 0,
      "StatusID": 4,
      "StatusName": "Applied",
      "Memo": "string",
      "PostDate": "2023-01-17T21:45:43.8792Z",
      "EffectiveDate": "2023-01-17",
      "LastUpdatedUTC": "2023-01-17T21:45:43.8792Z"
    }
  ]
}
```

**Field Notes:**
- Returns attendees for a specific session
- `PersonsStatus`: Array of person enrollment statuses
- Status codes: 0=Pending, 1=Waitlisted, 2=Enrolled, 3=Cancelled, 4=Applied, 8=WaitList

## Bunk Plans API

### Endpoint: `GET /bunks/plans`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 42,
    "orderascending": true,
    "pagenumber": 1,
    "pagesize": 100
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "ID": 255896,
      "Name": "Apache",
      "Code": "APAC",
      "IsActive": true,
      "SessionIDs": [
        0
      ],
      "BunkIDs": [
        0
      ]
    }
  ]
}
```

**Field Notes:**
- `ClientID`: The camp/client identifier
- `ID`: Unique bunk plan identifier
- `Name`: Display name of the bunk plan
- `Code`: Short code for the bunk plan
- `IsActive`: Whether the bunk plan is currently active
- `SessionIDs`: Array of session IDs this bunk plan applies to
- `BunkIDs`: Array of bunk IDs included in this plan

## Bunk Assignments API

### Endpoint: `GET /bunks/assignments`

**Parameters:**
```json
{
    "clientid": 754,
    "seasonid": 42,
    "bunkplanids": [123568],
    "bunkids": [155863],
    "pagenumber": 1,
    "pagesize": 500
}
```

**Response Example:**
```json
{
  "TotalCount": 0,
  "Next": "string",
  "Results": [
    {
      "ClientID": 754,
      "BunkPlanID": 123568,
      "BunkID": 155863,
      "Assignments": [
        {
          "ID": 1158976,
          "PersonID": 1555866,
          "LastUpdatedUTC": "2019-10-12T07:20:14Z",
          "IsDeleted": true
        }
      ]
    }
  ]
}
```

**Field Notes:**
- `ClientID`: The camp/client identifier
- `BunkPlanID`: The bunk plan this assignment belongs to
- `BunkID`: The specific bunk/cabin ID
- `Assignments`: Array of person assignments to this bunk
  - `ID`: Assignment ID
  - `PersonID`: ID of the person assigned
  - `LastUpdatedUTC`: When the assignment was last modified
  - `IsDeleted`: Whether this assignment has been deleted

## Family Persons API

### Endpoint: `GET /persons/{id}/familypersons`

**Response Example:**
```json
{
    "PersonID": 3227862,
    "FamilyPersons": [
        {
            "FamilyID": 3542288,
            "PersonID": 3227862,
            "RoleID": 1,
            "RoleName": "Primary Child"
        },
        {
            "FamilyID": 3542288,
            "PersonID": 3227865,
            "RoleID": 3,
            "RoleName": "Primary Parent"
        },
        {
            "FamilyID": 3542288,
            "PersonID": 3227866,
            "RoleID": 4,
            "RoleName": "Secondary Parent"
        },
        {
            "FamilyID": 3542288,
            "PersonID": 3227867,
            "RoleID": 2,
            "RoleName": "Sibling"
        }
    ]
}
```

## Relatives API

### Endpoint: `GET /persons/{id}/relatives`

**Response Example:**
```json
{
    "PersonID": 3227862,
    "Relatives": [
        {
            "ID": 3227865,
            "Name": {
                "First": "Sarah",
                "Last": "Katz",
                "Preferred": "Sarah"
            },
            "RelationshipType": "Mother",
            "IsGuardian": true,
            "IsPrimary": true,
            "IsWard": false,
            "IsEmergencyContact": true,
            "CanPickUp": true
        },
        {
            "ID": 3227866,
            "Name": {
                "First": "David",
                "Last": "Katz",
                "Preferred": "David"
            },
            "RelationshipType": "Father",
            "IsGuardian": true,
            "IsPrimary": false,
            "IsWard": false,
            "IsEmergencyContact": true,
            "CanPickUp": true
        },
        {
            "ID": 3227867,
            "Name": {
                "First": "Emma",
                "Last": "Katz",
                "Preferred": "Emma"
            },
            "RelationshipType": "Sibling",
            "IsGuardian": false,
            "IsPrimary": false,
            "IsWard": false,
            "IsEmergencyContact": false,
            "CanPickUp": false
        }
    ]
}
```

## Tags API

### Endpoint: `GET /persons/{id}/tags`

**Response Example:**
```json
{
    "PersonID": 3227862,
    "Tags": [
        {
            "ID": 789,
            "Name": "Returning Camper",
            "Category": "Status",
            "IsSeasonal": false,
            "Color": "#4CAF50",
            "LastUpdatedUTC": "2024-01-15T10:00:00Z"
        },
        {
            "ID": 790,
            "Name": "Orchestra Member",
            "Category": "Activities",
            "IsSeasonal": true,
            "Color": "#2196F3",
            "LastUpdatedUTC": "2024-06-01T09:30:00Z"
        },
        {
            "ID": 791,
            "Name": "Vegetarian",
            "Category": "Dietary",
            "IsSeasonal": false,
            "Color": "#FF9800",
            "LastUpdatedUTC": "2024-02-20T11:15:00Z"
        }
    ]
}
```

## Usage Notes

### Pagination
Most list endpoints support pagination with these parameters:
- `pagenumber`: Page number (1-based)
- `pagesize`: Number of results per page (max usually 500)
- Response includes `TotalResults` for calculating total pages

### Status Codes
Common status values for attendees:
- 0: Pending
- 1: Waitlisted  
- 2: Enrolled
- 3: Cancelled
- 4: Withdrawn

### Date Formats
- All dates are in ISO 8601 format
- Times are in UTC unless otherwise specified
- Age fields are decimal (e.g., 14.06 = 14 years, 6 months)

### Gender IDs
- 0: Female
- 1: Male
- 3: Undefined

### Required Parameters
All endpoints require:
- `clientid`: Your CampMinder client ID
- Most endpoints also require `seasonid` for filtering by camp year

### Rate Limiting
- API implements rate limiting (details in credentials)
- Use exponential backoff for retries
- Batch operations when possible

### Empty/Null Fields
- Many fields can be null or empty
- Always check for field existence before accessing
- Gender identity fields are often empty for historical data

## Common Patterns for Script Development

### 1. Fetching Related Data
When syncing persons, you often need to fetch related data in sequence:
```
1. Get persons (with includes for related data)
2. For each person, check FamilyPersons array
3. Use family IDs to link siblings
4. Use relative IDs for parent relationships
```

### 2. Handling Enrollments
To get all campers for a session:
```
1. Get session details
2. Fetch attendees for that session
3. Filter by status=2 (Enrolled)
4. Use PersonID to fetch full person details if needed
```

### 3. Building Bunk Assignments
Complete bunk assignment flow:
```
1. Get sessions for the season
2. For each session, get available bunks (bunk plans)
3. Get attendees for the session
4. Get existing bunk assignments
5. Match unassigned attendees to available bunks
```

### 4. Year-Specific Data
When handling historical data:
- Sessions may have same IDs across years
- Always filter by seasonid
- Store year field explicitly in your database
- Person IDs are globally unique across years