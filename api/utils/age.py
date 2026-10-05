"""CampMinder's adult age, shared by the API's services."""

# The age at or over which CampMinder's person is an adult (owner ruling 2026-09-22: raised from 18 to 21 -- teens
# 18-20 are still campers in summer and teen programs). The same cutoff lives in pocketbase/sync/persons.go
# (adultAgeCutoff) and frontend/src/utils/age.ts (ADULT_AGE, how an age is DISPLAYED; a test holds the two equal).
# Keep all three in sync if it ever moves (kindred#2777).
ADULT_AGE = 21
