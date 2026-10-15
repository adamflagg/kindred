# CSV Preparation Guide

This guide explains how to properly prepare and format CSV files for importing bunking requests into Kindred.

## Table of Contents
- [Required CSV Format](#required-csv-format)
- [Field Mappings](#field-mappings)
- [Data Entry Best Practices](#data-entry-best-practices)
- [Common Issues and Solutions](#common-issues-and-solutions)
- [Pre-Import Checklist](#pre-import-checklist)
- [Import Process](#import-process)

## Required CSV Format

The bunking requests CSV must be exported from CampMinder with specific fields. The upload is rejected unless `PersonID`, `First Name` and `Last Name` headers are all present (case-insensitive). The request columns below are optional as far as the upload check goes, but a file without them produces no requests. The system expects the following columns:

### Essential Columns

1. **PersonID** (Required)
   - The CampMinder person ID for the camper
   - Must be a positive integer
   - Used to match campers in the system

2. **Share Bunk With** (Required)
   - Names of campers this person wants to bunk with
   - Can contain multiple names
   - Supports various formats (see examples below)

3. **Do Not Share Bunk With** (Optional)
   - Names of campers this person should NOT bunk with
   - Can contain multiple names
   - Important for managing conflicts

4. **BunkingNotes Notes** (Optional)
   - General bunking preferences and notes
   - May contain age preferences, special requests
   - Parsed as its own source (`bunking_notes`)

5. **Internal Bunk Notes** (Optional)
   - Staff-only notes about bunking
   - Not visible to families
   - Used for special circumstances
   - Parsed as its own source (`internal_notes`)

6. **RetParent-Socializewithbest** (Optional)
   - The parent's "socialize with" dropdown (an age preference)
   - Informational: it does not count toward the headline satisfaction number

### Example CSV Structure

```csv
PersonID,Share Bunk With,Do Not Share Bunk With,BunkingNotes Notes,Internal Bunk Notes
12345,"Sarah Johnson, Emma Wilson","Michael Brown","Wants older kids",""
12346,"Jake Miller #1","","Keep with last year's group","Check medical needs"
12347,"Anyone from Cabin 3","Tommy Smith","","Conflict resolved 2024"
```

## Field Mappings

Understanding how CSV fields map to the database helps ensure correct data entry:

| CSV Field | Database Field | Purpose |
|-----------|----------------|---------|
| PersonID | requester_id | Identifies the camper making requests (CampMinder ID) |
| Share Bunk With | source `bunk_request_form`, parsed into bunk_requests | Parent form; positive requests (and negatives or age preferences written there) |
| Do Not Share Bunk With | source `staff_not_bunk_with`, parsed into bunk_requests (not_bunk_with) | Creates negative bunking requests; enforced as a hard separation |
| BunkingNotes Notes | source `bunking_notes` | Preferences and context, AI-parsed |
| Internal Bunk Notes | source `internal_notes` | Staff-only information, AI-parsed (kept separate from BunkingNotes) |
| RetParent-Socializewithbest | source `socialize_with` | Age preference from the dropdown, not AI-parsed |

Each CSV column lands in `original_bunk_requests` under its source; the processor then builds `bunk_requests`. Details: `docs/architecture/bunk-request-pipeline.md` and `docs/architecture/request-classification.md`.

## Data Entry Best Practices

### 1. Name Formats

The system supports various name formats. Use the most complete information available:

**Good Examples:**
- "Sarah Johnson" (full name - best)
- "Emma Wilson, Olivia Davis" (multiple names)
- "Jake M." (first name + last initial)
- "Jake Miller #1" (with priority indicator)

**Avoid:**
- "Sarah" (first name only - too ambiguous)
- "The Johnson girl" (unclear reference)
- "My friend" (no identifiable information)

### 2. Multiple Names

When entering multiple names in a single cell:

**Correct Formats:**
- Comma-separated: "Sarah Johnson, Emma Wilson, Olivia Davis"
- Line breaks (if your system supports):
  ```text
  Sarah Johnson
  Emma Wilson
  Olivia Davis
  ```
- Semi-colon separated: "Sarah Johnson; Emma Wilson; Olivia Davis"

**System Parsing:**
- The system intelligently splits on commas, semicolons, "and", "&"
- Line breaks are preserved and parsed correctly
- Extra spaces are automatically trimmed

### 3. Priority Indicators

Use these keywords to indicate high-priority requests:

- **"#1"** or **"number one"**: Highest priority request
- **"must be with"**: Critical pairing
- **"MUST"** (all caps): Strong emphasis
- Position matters: Names listed first get higher priority

**Examples:**
- "Sarah Johnson #1" (Sarah is top priority)
- "Must be with Emma Wilson" (critical request)
- "Jake Miller #1, Tommy Smith, Alex Brown" (Jake highest, then Tommy, then Alex)

### 4. Age Preferences

Specify age preferences clearly:

**In "Share Bunk With" column:**
- "older kids" or "older campers"
- "younger kids" or "younger campers"
- "kids my age" or "same age"

**System Recognition:**
- Detects keywords: "older", "younger", "age"
- Creates age preference requests automatically
- Higher priority when explicitly stated

### 5. Prior Year Continuity

To request bunking with last year's group:

**Recognized Phrases:**
- "same as last year"
- "keep our bunk together"
- "last year's cabin"
- "previous summer group"
- "Jake and Emma from last year" (specific names)

**System Behavior:**
- Automatically finds eligible returners
- Creates high-priority continuity requests
- Can specify particular campers or "any returners"

### 6. Negative Requests

Handle "Do Not Share Bunk With" carefully:

**Valid Reasons:**
- Documented conflicts
- Family requests
- Behavioral incompatibilities

**Best Practices:**
- Be specific with names
- Document reasons in Internal Notes
- Consider if issue is current or resolved

## Common Issues and Solutions

### Issue 1: Name Ambiguity

**Problem:** Multiple campers with same first name

**Solutions:**
- Always use full names when possible
- Include last initial minimum: "Sarah J."
- Add identifiers: "Sarah Johnson (from Denver)"
- Use middle names if known

### Issue 2: Nickname vs. Legal Names

**Problem:** Request uses "Jake" but system has "Jacob"

**Solutions:**
- Check CampMinder for both versions
- Include both if uncertain: "Jake/Jacob Miller"
- Add note about nickname usage
- System attempts fuzzy matching

### Issue 3: Multi-Line Cell Data

**Problem:** Excel showing single line but data has breaks

**Solutions:**
- Enable "Wrap Text" in Excel to see all content
- Check cell contents in formula bar
- Export as CSV to verify formatting
- System handles multi-line correctly

### Issue 4: Special Characters

**Problem:** Names with apostrophes, hyphens, accents

**Solutions:**
- Include as written: "O'Brien", "Smith-Jones"
- Don't use quotes around names
- UTF-8 encoding preserves special characters
- System handles most special characters

### Issue 5: Missing PersonID

**Problem:** Some rows lack PersonID

**Solutions:**
- These rows will be skipped during import
- Verify all active campers have PersonIDs
- Check CampMinder export settings
- Contact support if IDs are missing

## Pre-Import Checklist

Before importing your CSV file:

### 1. Data Validation
- [ ] All rows have valid PersonID values
- [ ] Names use full format where possible
- [ ] Multiple names properly separated
- [ ] Priority keywords used appropriately
- [ ] Age preferences clearly stated
- [ ] Prior year requests identifiable

### 2. File Preparation
- [ ] Save as UTF-8 encoded CSV
- [ ] Any filename works; the upload is stored as `<year>_latest.csv` and the previous one is backed up
- [ ] No extra header rows or footers
- [ ] No formulas - values only
- [ ] File size under the upload's 50MB limit

### 3. Content Review
- [ ] Negative requests are justified
- [ ] Internal notes are appropriate
- [ ] No sensitive medical information
- [ ] Names match CampMinder records
- [ ] Special situations documented

### 4. Final Checks
- [ ] Open CSV in text editor to verify format
- [ ] Check for hidden characters or formatting
- [ ] Ensure column headers match exactly
- [ ] Save backup copy before import

## Import Process

### 1. Upload
Staff with the bunking-manage permission use the **Upload Requests** button in the summer header (`BunkRequestsUpload`). It posts the file to `/api/custom/sync/bunk_requests_upload` for the selected year, which must be one of the two synced seasons (the current season or the one before it), then runs the CSV sync and request processing. The indicator beside the button shows when the pipeline has finished. There is no `drive/` directory and no import script any more.

### 2. What the upload does
- Saves the file as `pb_data/bunk_requests/<year>_latest.csv`, backing up the previous one
- Syncs each row into `original_bunk_requests`, skipping rows whose text has not changed
- Parses the text (AI for the free-text columns), matches names to campers, and creates `bunk_requests`
- Flags low-confidence matches for manual review

### 3. Re-uploading
Re-upload is safe: unchanged rows are detected and left alone, so only new or edited text is reprocessed.

### 4. Review Import Results
The pipeline indicator and the sync status page report:
- Total requests processed
- Successful imports
- Low-confidence matches needing review
- Any errors encountered

### 5. Post-Import Steps
1. Check the request-review views for low-confidence matches
2. Resolve any name ambiguities
3. Address missing camper issues
4. Verify priority assignments

## Troubleshooting Import Issues

### "Missing required columns"
- The file needs `PersonID`, `First Name` and `Last Name` headers
- Check that the export is the CampMinder bunking report, not another one

### "Invalid PersonID"
- PersonID must be positive integer
- Check for extra spaces or characters
- Verify against CampMinder export

### "Encoding error"
- Re-save file as UTF-8
- Remove special characters if needed
- Try opening in different editor

### "Parse error on line X"
- Check for unmatched quotes
- Look for extra commas
- Verify line breaks are consistent

## Best Practices Summary

1. **Start Early**: Begin preparing CSV well before bunking deadline
2. **Use Full Names**: Always prefer complete names over partials
3. **Document Everything**: Use notes fields for context
4. **Test Small**: Try importing subset first
5. **Keep Backups**: Save original exports
6. **Verify Results**: Always check the request-review views after import
7. **Iterate**: Re-import is safe - system updates existing records

---

*Remember: Good data preparation leads to accurate bunking assignments and happier campers!*