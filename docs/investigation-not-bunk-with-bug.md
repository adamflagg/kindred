# Investigation: not_bunk_with Processing Issues

## Date: 2026-01-20

## Original Problem

Camper 6325675 (Gabriella Bauer-Kahan) has a raw `not_bunk_with` field containing "Amalia Smith", but processed records showed siblings as targets (Aiden and Rebecca Bauer-Kahan) instead.

## Root Cause Found and Fixed

### Issue: AI Hallucinating "SIBLING" Placeholder

The AI (GPT-4.1-nano) was incorrectly outputting `target_name = "SIBLING"` for plain name inputs like "Amalia Smith".

**Evidence from debug logs:**
```
[AI-PARSE] Input: field='Do Not Share Bunk With' requester='Gabriella Bauer-Kahan' text='Amalia Smith'
[AI-PARSE] Output: targets=['SIBLING'] request_types=['not_bunk_with']  # WRONG!
```

The SIBLING placeholder then triggered `placeholder_expander.py` to expand it to actual siblings (Aiden and Rebecca Bauer-Kahan).

### Fix Applied

Removed the SIBLING placeholder entirely from `config/prompts/parse_not_bunk_with.txt` because:

1. **Analysis of all 31 not_bunk_with records showed ZERO actual sibling references** - All records contain explicit names like "Amalia Smith", "Kyla Udell", etc.
2. **The SIBLING placeholder was causing false positives** - The AI was hallucinating it for normal names

**Changes made to `config/prompts/parse_not_bunk_with.txt`:**
- Removed "SPECIAL PLACEHOLDERS" section (lines 30-36)
- Removed Example 8 about sibling references
- Changed `target_name = person's name or "SIBLING"` to `target_name = person's name (always extract the actual name)`
- Changed output requirements to `target_name: Person's full name (always extract actual names, never placeholders)`

**After fix:**
```
[AI-PARSE] Input: field='Do Not Share Bunk With' requester='Gabriella Bauer-Kahan' text='Amalia Smith'
[AI-PARSE] Output: targets=['Amalia Smith'] request_types=['not_bunk_with']  # CORRECT!
```

## Debug Logging Added

Added `[AI-PARSE]` debug logging that activates when `debug=true` is passed:

### Files Modified for Debug Logging

1. **`pocketbase/sync/process_requests.go`** - Logs Python output when debug=true
2. **`pocketbase/sync/api.go`** - Already had debug query param
3. **`bunking/sync/bunk_request_processor/process_requests.py`** - Added debug param threading
4. **`bunking/sync/bunk_request_processor/orchestrator/orchestrator.py`** - Stores and passes debug flag
5. **`bunking/sync/bunk_request_processor/integration/ai_types.py`** - Added `debug: bool = False` to AIServiceConfig
6. **`bunking/sync/bunk_request_processor/integration/provider_factory.py`** - Passes debug to OpenAIProvider
7. **`bunking/sync/bunk_request_processor/integration/openai_provider.py`** - Added conditional `[AI-PARSE]` logging

### Usage

```bash
# Via API
curl -X POST "http://127.0.0.1:8090/api/custom/sync/process-requests?session=all&force=true&debug=true&source_field=not_bunk_with"

# Via CLI
uv run python -m bunking.sync.bunk_request_processor.process_requests \
  --year 2025 --session all --source-field not_bunk_with --force --clear-existing --debug
```

## Remaining Issues to Address

### Issue 1: 400 Errors (validation_not_unique) - 14 occurrences

**Cause:** The unique constraint on `bunk_requests` is:
```sql
CREATE UNIQUE INDEX ON bunk_requests (requester_id, requestee_id, request_type, year, session_id)
```

Note: `source_field` is NOT in the unique index.

**What happens:**
1. Previous run processes `BunkingNotes Notes` → creates record for (requester=X, requestee=Y, type=not_bunk_with, session=Z)
2. Current run processes `Do Not Share Bunk With` with `--clear-existing`
3. `--clear-existing` only clears records where `source_field='Do Not Share Bunk With'`
4. Tries to create same (requester=X, requestee=Y, type=not_bunk_with, session=Z) → FAILS with duplicate key

**Example from logs:**
```
Person 19640456 (Bennett Levis) already has:
  requestee_id=14761236, type=not_bunk_with, session=1235406, source=BunkingNotes Notes

Processing tries to create:
  requestee_id=14761236, type=not_bunk_with, session=1235406, source=Do Not Share Bunk With
  → 400 error: validation_not_unique
```

**Possible fixes:**
1. Change unique index to include `source_field` (allows multiple sources for same request)
2. Make `--clear-existing` clear ALL sources for the requester, not just current source
3. Check for existing record before insert and skip/update instead

**Semantic question:** Should the same (requester, requestee, type, session) be allowed from multiple sources? Probably not - a request is a request regardless of source.

### Issue 2: Unresolved Names

Some names don't resolve because the person doesn't exist in the database.

**Example:**
```
Input: "Addy Kniffin & Pallie Rocchino"
AI Output: targets=['Addy Kniffin', 'Pallie Rocchino']  # Correct parsing

Phase 2 Resolution:
  - "Pallie Rocchino" → resolved=True, person=6053459
  - "Addy Kniffin" → resolved=False, candidates=0  # No match found
```

This is expected behavior when the target person isn't in the database (might not be attending camp, misspelled name, etc.). The system creates a placeholder request with negative ID.

### Issue 3: requester_id Field is NULL

Some `original_bunk_requests` records have `requester_id = NULL` even though they have a valid `requester` relation.

**Example:**
```
Record for Noa Segev:
  requester = (relation to persons record with cm_id=17542317)
  requester_id = None  # Should be 17542317
```

This doesn't break processing (code uses the relation), but is inconsistent.

## All 31 not_bunk_with Records (for reference)

```
Requester: Kitty Dougherty
Content: 'Not with Arya Shachar/other Hasner kids if possible'

Requester: Henry Heindl
Content: 'Adam Taichman'

Requester: Sivan Stone
Content: "Sloane 'Lex' Cherniss"

Requester: Aaron Markman
Content: 'Itayi Simon Nyamuzuwe'

Requester: Milo Aufrecht
Content: 'Aleko (Alexander) Levis'

Requester: Marley Brewer
Content: 'Izu Montoya'

Requester: Bennett Levis
Content: "Rezi Sobel Robinson (Ses 4), Avigdor Sussman Corace (?) Declan O'Brian (Ses 2) Lorenzo Rossi (?)"

Requester: Noga Levy
Content: 'Neg req Ashley Connorton in Ses 3'

Requester: Zaiden Livingston
Content: "Declan O'Brien"

Requester: Caleb Reichenberg
Content: 'Arlo Spiro'

Requester: Ivy Hershenson
Content: 'Different unit than Sebby Kreamer'

Requester: Sofia Rae
Content: 'Kyla Udell'

Requester: Ally Erlikh
Content: 'Sasha Smirnova (mom understands that they will be together)'

Requester: Autumn Guinan
Content: 'Noga Levy'

Requester: Nico Jacques
Content: 'Olive Miskie'

Requester: Santi Westbury
Content: 'Sammy Dimond'

Requester: Eleanor Yanow
Content: 'Madeline Yanow'

Requester: Shira Berman
Content: 'Zoe Corbett and Thelma Poxon-Hudson'

Requester: Oliver Dewar
Content: "Declan O'Brien"

Requester: Yael Marks
Content: 'Sadie Mander'

Requester: Lev Crispi
Content: 'separate from Vivienne Cooper (family friends just want separation), separate from Matan Altman'

Requester: Gabby Bauer-Kahan
Content: 'Amalia Smith'

Requester: Leah Rutter
Content: 'Lola Tenorio-Metz, Ari Sotomayor (ideal if all 3 are in separate cabins but ok if not)'

Requester: Sadie Zalewski
Content: "Ses 3 G4 '24 - Havia Leonard, Zara Quiter, Samara Reynolds, Elana Schaevitz, Audrey & Sasha Weinberg"

Requester: Jenny Eckert
Content: 'Ellie Evans'

Requester: Arielle Schriner
Content: 'Talia Zimmerman (neg relationship together at hebrew school) - ok if together but Shoshie call if so'

Requester: Harper Tong
Content: 'Lizzy Diamond'

Requester: Noa Segev
Content: 'Addy Kniffin & Pallie Rocchino'

Requester: Ethan Przybyla
Content: 'Aleko Levis & Jude Schliffer'

Requester: Zoey Corbett
Content: 'Kyla Udell'

Requester: Olivia Lieberman
Content: 'Natalie Goldstein'
```

**Key observation:** None of these contain sibling references like "my brother", "twin", etc. All use explicit names.

## Files Modified in This Investigation

### Prompt Fix
- `config/prompts/parse_not_bunk_with.txt` - Removed SIBLING placeholder

### Debug Logging
- `pocketbase/sync/process_requests.go` - Log Python output in debug mode
- `bunking/sync/bunk_request_processor/process_requests.py` - Thread debug flag
- `bunking/sync/bunk_request_processor/orchestrator/orchestrator.py` - Accept/store debug flag
- `bunking/sync/bunk_request_processor/integration/ai_types.py` - Add debug to AIServiceConfig
- `bunking/sync/bunk_request_processor/integration/provider_factory.py` - Pass debug to provider
- `bunking/sync/bunk_request_processor/integration/openai_provider.py` - Add [AI-PARSE] logging

## Test Commands

```bash
# Run full not_bunk_with processing with debug
uv run python -m bunking.sync.bunk_request_processor.process_requests \
  --year 2025 --session all --source-field not_bunk_with --force --clear-existing --debug 2>&1 | tee /tmp/debug.log

# Search for specific person in logs
grep "Bauer-Kahan\|6325675" /tmp/debug.log

# Count 400 errors
grep -c "Status code:400" /tmp/debug.log

# Find AI parse input/output for a name
grep -A5 "text='Amalia Smith'" /tmp/debug.log
```

## Summary

1. **SIBLING hallucination bug: FIXED** - Removed placeholder from prompt
2. **Debug logging: ADDED** - Can trace AI input/output with `debug=true`
3. **400 errors: NOT FIXED** - Need to decide on handling duplicate requests from different sources
4. **Unresolved names: EXPECTED** - Some target people aren't in database
