# Visual Indicators Guide

This guide explains the visual indicators used throughout Kindred to help staff quickly identify important information and potential issues.

## Table of Contents
- [Overview](#overview)
- [Camper Indicators](#camper-indicators)
- [Bunk Indicators](#bunk-indicators)
- [Request Indicators](#request-indicators)
- [Friend Group Indicators](#friend-group-indicators)
- [Status Colors](#status-colors)
- [Interactive Features](#interactive-features)

## Overview

Visual indicators provide at-a-glance information about:
- Camper request status
- Bunk capacity and composition
- Request priorities and confidence
- Friend group health
- Potential issues requiring attention

## Camper Indicators

### No Requests Warning

**Visual**: Red ring border with warning icon (⚠️)

**Meaning**: Camper has no bunking requests

**Where shown**:
- Bunking board (unassigned section)
- Bunking board (assigned to bunks)
- Campers list view

**Action needed**:
- Review camper's preferences
- Check socialize_with_best field
- Consider adding age preference
- Contact family if needed

### Camper Status Icons

**In Bunks**:
- 🏠 **Returning camper**: Attended previously
- ⭐ **New camper**: First time at camp
- 🎯 **Has requests**: Active bunking requests
- ⚠️ **No requests**: Missing bunking preferences

**Drag States**:
- Solid border: Normal state
- Dashed border: Being dragged
- Green highlight: Valid drop target
- Red highlight: Invalid placement

## Bunk Indicators

### Capacity Indicators

**Visual**: Progress bar showing X/12 campers

**Color coding**:
- Green (0-8): Plenty of space
- Yellow (9-10): Nearly full
- Orange (11): One spot left
- Red (12): At capacity

### Lock Status

**Visual**: Lock icon (🔒) in bunk header

**Meaning**: Bunk assignments are locked

**Behavior**:
- Prevents camper additions/removals
- Solver respects locked bunks
- Manual override available

### Composition Badges

**Grade Distribution**:
- Shows grade levels present
- Red highlight if >66% from one grade

**Age Spread**:
- Shows age range in months
- Red warning if >24 months

**New/Returning Mix**:
- Bar showing ratio
- Warning if 1 new with 11 returning

## Request Indicators

### Priority Levels

**Visual**: Number badges (1️⃣ 2️⃣ 3️⃣)

**Meaning**:
- 1️⃣ Highest priority request
- 2️⃣ Second priority
- 3️⃣ Third+ priority

**With lock icon** (🔒): Priority manually locked

### Confidence Scores

**Color coding**:
- 🟢 Green (80-100%): High confidence match
- 🟡 Yellow (60-79%): Medium confidence
- 🔴 Red (0-59%): Low confidence, needs review

**Visual format**: Colored dot or background

### Request Types

**Icons**:
- ➕ **Bunk with**: Positive request
- ➖ **Not bunk with**: Negative request
- 📅 **Prior year**: Continuity request
- 👶/👴 **Age preference**: Younger/older preference

### Reciprocal Indicators

**Visual**: ↔️ Two-way arrow

**Meaning**: Both campers requested each other

**Importance**: Higher satisfaction likelihood

### Parse Notes Icons

**Visual**: 💬 Speech bubble

**Contains**:
- Keyword detection results
- Confidence explanations
- Special circumstances

**Hover to view** full parse notes

## Friend Group Indicators

### Completeness Meter

**Visual**: Circular progress indicator

**Color coding**:
- 🟢 Green (>60%): Well-connected group
- 🟡 Yellow (40-60%): Needs attention
- 🔴 Red (<40%): At risk of deactivation

**Shows**: X% with exact percentage

### Group Size Badge

**Visual**: Number in circle

**Color coding**:
- Green (2-10): Optimal size
- Yellow (11): Near capacity
- Red (12+): Must split

### Stability Indicator

**Visual**: Line graph icon

**Shows**:
- 📈 Trending up: Increasing stability
- ➡️ Stable: Consistent over time
- 📉 Trending down: Decreasing stability

### Status Indicators

**Icons**:
- ✅ **Active**: Group is active
- ⏸️ **Inactive**: Temporarily disabled
- 🔒 **Locked**: Protected from changes
- 👤 **Manual**: Created by staff

## Status Colors

### Universal Color Scheme

**Green** ✅
- Good/optimal state
- Action completed
- High confidence
- Well-connected

**Yellow** ⚠️
- Caution/attention needed
- Medium confidence
- Near limits
- Review suggested

**Red** ❌
- Problem/issue
- Low confidence
- Over limits
- Action required

**Blue** ℹ️
- Informational
- Neutral state
- No action needed

**Gray** 
- Disabled/inactive
- Not applicable
- Historical data

## Interactive Features

### Hover Effects

**On campers**:
- Shows tooltip with details
- Displays requests summary
- Shows age and grade

**On bunks**:
- Shows composition details
- Lists current campers
- Displays statistics

**On requests**:
- Shows full parse notes
- Displays confidence breakdown
- Shows related campers

### Click Actions

**Camper cards**:
- Single click: Select/view details
- Double click: Open full profile

**Request items**:
- Click: Expand/collapse details
- Action buttons: Approve/reject

**Friend groups**:
- Click: View members
- Edit button: Modify group

### Drag and Drop

**Visual feedback**:
- Cursor changes to grab hand
- Item lifts slightly
- Valid targets highlight green
- Invalid targets show red

**During drag**:
- Original position shows placeholder
- Drop zones become visible
- Capacity limits enforced

## Accessibility

### Screen Reader Support

All visual indicators include:
- Descriptive aria-labels
- Role attributes
- Status announcements

### Keyboard Navigation

- Tab through elements
- Enter/Space to activate
- Arrow keys for navigation
- Escape to cancel actions

### High Contrast Mode

- Stronger color differentiation
- Additional text labels
- Pattern overlays for color-blind users

## Best Practices

### 1. Regular Monitoring
- Scan for red indicators daily
- Address warnings promptly
- Review yellow items regularly

### 2. Priority Order
1. Red warnings (immediate action)
2. No-request campers
3. Low confidence matches
4. Yellow cautions
5. Optimization opportunities

### 3. Using Filters
- Hide resolved items
- Focus on specific issues
- Use color filters effectively

### 4. Batch Operations
- Group similar issues
- Use bulk actions when appropriate
- Document decisions made

## Customization

### Adjusting Thresholds

Some indicators can be customized:
- Confidence score boundaries
- Group completeness thresholds
- Capacity warning levels

Access via Solver Configuration

### Display Preferences

User preferences available for:
- Color intensity
- Icon size
- Tooltip delay
- Animation speed

## Mobile Considerations

On smaller screens:
- Icons may be simplified
- Touch targets enlarged
- Some details hidden until tapped
- Swipe gestures enabled

---

*Remember: Visual indicators are aids for decision-making. Always consider the full context before taking action based on any single indicator.*