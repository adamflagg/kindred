# Lock Groups Guide

Lock groups allow you to keep specific campers together during solver runs. When the solver optimizes cabin assignments, it treats all members of a lock group as a unit that must stay together.

## Overview

### What Lock Groups Do

- **Keep campers together**: All members of a lock group will be assigned to the same bunk
- **Protect special arrangements**: Siblings, close friends, or campers with special needs
- **Override solver optimization**: The solver will not separate locked group members

### When to Use Lock Groups

- **Siblings**: Keeping family members together when requested
- **Special requests**: Accommodating specific family or staff requests
- **Medical/behavioral needs**: Campers who need to be with specific bunkmates
- **Pre-arranged groups**: Groups where placement has already been decided

## Using Lock Groups in the UI

### Accessing the Lock Management Panel

1. Navigate to a session detail page
2. Click the **Locks** tab
3. You'll see the Lock Management Panel

### Creating a Lock Group

1. Click **New Group** button
2. Fill in the form:
   - **Group Name**: A descriptive name (e.g., "Smith Siblings", "Medical Pair")
   - **Color**: Choose a color for visual identification on the bunking board
   - **Description** (optional): Notes about why the group exists
3. Click **Create Group**

### Adding Members to a Lock Group

Members are added from the bunking board:

1. Go to the **Bunking** tab
2. Find the camper(s) you want to add
3. Right-click on a camper card → **Add to Lock Group**
4. Select the group to add them to

Alternatively, select multiple campers and use the bulk action menu.

### Viewing Lock Groups

The Lock Management Panel shows:

| Column | Description |
|--------|-------------|
| Color dot | Visual identifier matching bunking board |
| Group Name | Descriptive name |
| Members | Number of campers in the group |
| Actions | Delete button |

Click on a group row to expand and see:
- All member names
- Option to remove individual members

### Removing Members

1. Expand the group by clicking its row
2. Click the unlock icon next to a member's name
3. Confirm removal

### Deleting a Lock Group

1. Click the trash icon on the group row
2. Confirm deletion (removes group and all member associations)

## Visual Indicators

### On the Bunking Board

Campers in lock groups are identified by:

- **Colored ring**: Matches the group color
- **Lock icon**: Shows on the camper card
- **Cursor change**: Shows "not allowed" cursor when trying to drag individually

### Lock States

| State | Visual | Meaning |
|-------|--------|---------|
| Not locked | No ring | Camper can be moved freely |
| Pending | Yellow, unlock icon | Being added to a group |
| Locked | Group color ring, lock icon | In a lock group |

## Dragging Locked Campers

When you drag a camper who is in a lock group:

1. **All group members move together** - You'll see a stacked card effect
2. **Toast notification** - Shows "Moving group of X campers"
3. **Target validation** - System checks if the target bunk can fit the entire group

If the target bunk doesn't have enough space for all group members, the move will fail.

## Database Schema

Lock groups use two PocketBase collections:

### `locked_groups` Collection

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | PocketBase ID |
| `name` | text | Group name |
| `color` | text | Hex color code |
| `session_id` | number | CampMinder session ID |
| `year` | number | Year (2013-2100) |
| `created_by` | text | Who created the group |
| `description` | text | Optional notes |

### `locked_group_members` Collection

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | PocketBase ID |
| `group_id` | text | Reference to locked_groups.id |
| `attendee_id` | number | CampMinder person ID |
| `added_by` | text | Who added this member |

## API Usage

### Query Lock Groups

```bash
# Get all lock groups for a session
curl "http://localhost:8090/api/collections/locked_groups/records?filter=session_id=1234567%26%26year=2025" \
  -H "Authorization: $TOKEN"
```

### Query Group Members

```bash
# Get members of a specific group
curl "http://localhost:8090/api/collections/locked_group_members/records?filter=group_id='abc123'" \
  -H "Authorization: $TOKEN"
```

### Create a Lock Group

```bash
curl -X POST "http://localhost:8090/api/collections/locked_groups/records" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smith Siblings",
    "color": "#3b82f6",
    "session_id": 1234567,
    "year": 2025,
    "description": "Keep together per family request"
  }'
```

### Add Member to Group

```bash
curl -X POST "http://localhost:8090/api/collections/locked_group_members/records" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": "abc123",
    "attendee_id": 9876543
  }'
```

## Solver Integration

When the solver runs:

1. **Lock groups are loaded** from the database
2. **Members are identified** by their CampMinder person IDs
3. **Constraint is added**: All group members must be in the same bunk
4. **Solver optimizes** while respecting the constraint

### Solver Behavior

- Lock groups are treated as **hard constraints** - they cannot be violated
- If a lock group is too large for any available bunk, the solver will fail
- Lock groups take precedence over friend requests between non-grouped campers

## Best Practices

### Group Naming

Use descriptive names that explain why the group exists:
- "Smith/Jones Siblings" (family)
- "Medical: Allergy Partners" (medical need)
- "Parent Request: Sarah's Group" (family request)

### Group Size

- Keep groups **smaller than the smallest bunk capacity**
- If a group is too large, consider splitting into sub-groups
- Maximum practical size depends on your cabin layout

### Color Selection

- Use distinct colors for different group types
- Consistent colors help staff quickly identify group purpose
- Available colors: Blue, Green, Purple, Orange, Pink, Teal, Red, Yellow

### Documentation

Use the description field to record:
- Who requested the grouping
- When the request was made
- Any special considerations

## Troubleshooting

### Group Not Showing on Bunking Board

1. Check that the session/year filters match
2. Verify members are enrolled attendees
3. Refresh the page

### Cannot Move Locked Camper

This is expected behavior. To move:
1. Remove from the lock group, OR
2. Move the entire group together

### Solver Fails with Lock Groups

Check if:
- Any group exceeds the maximum bunk capacity
- Group members are actually enrolled in the session
- There are conflicting lock groups (same person in multiple groups)

### Members Not Appearing in Group

1. Verify the `attendee_id` matches the person's CampMinder ID
2. Check the person is enrolled for the correct session/year
3. Ensure the member record was saved successfully

## Related Features

- **[Request Management](./request-management.md)**: Managing bunking requests
- **[Scenario Management](./scenario-management.md)**: Draft assignments with locks
- **[Solver Configuration](../solver-configuration.md)**: Constraint settings

---

*Lock groups are a powerful tool for honoring specific placement requirements. Use them thoughtfully to balance special requests with overall optimization.*
