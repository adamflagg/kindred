package sync

import (
	"regexp"
	"slices"
	"strings"
)

// Program families for the campership ledger (spec §6.3, analysis §6.4). The
// aid_postings.program_family and aid_attribution_overrides.program_family
// selects (pb_migrations/1500000198, 1500000199) carry exactly these values, in
// this order; TestAidVocabularyMatchesMigration pins the two together.
const (
	programFamilySummer       = "summer"
	programFamilyQuest        = "quest"
	programFamilyTeen         = "teen"
	programFamilyBMitzvah     = "bmitzvah"
	programFamilyFamilyCamp   = "family_camp"
	programFamilyAdultWeekend = "adult_weekend"
	programFamilyFamilySchool = "family_school"
	programFamilyOther        = "other"
)

var aidProgramFamilies = []string{
	programFamilySummer, programFamilyQuest, programFamilyTeen, programFamilyBMitzvah,
	programFamilyFamilyCamp, programFamilyAdultWeekend, programFamilyFamilySchool, programFamilyOther,
}

// sessionTypeProgramFamily is the DEFAULT map from camp_sessions.session_type
// (the values sessions.go assigns) to a program family. Sub-project 3's program
// profiles replace it for the calculator; the ledger keeps this default so it
// does not depend on the rules document. Any session_type not listed is "other".
var sessionTypeProgramFamily = map[string]string{
	sessionTypeMain:     programFamilySummer,
	sessionTypeEmbedded: programFamilySummer,
	"ag":                programFamilySummer,
	sessionTypeQuest:    programFamilyQuest,
	sessionTypeSCIT:     programFamilyTeen,
	sessionTypeTLI:      programFamilyTeen,
	"teen":              programFamilyTeen,
	"bmitzvah":          programFamilyBMitzvah,
	"hebrew":            programFamilyBMitzvah,
	sessionTypeFamily:   programFamilyFamilyCamp,
	sessionTypeAdult:    programFamilyAdultWeekend,
	"school":            programFamilyFamilySchool,
}

func programFamilyForSessionType(sessionType string) string {
	if family, ok := sessionTypeProgramFamily[strings.ToLower(strings.TrimSpace(sessionType))]; ok {
		return family
	}
	return programFamilyOther
}

func isAidProgramFamily(v string) bool {
	return slices.Contains(aidProgramFamilies, v)
}

// aidWhitespaceClass matches everything Python's Unicode-aware `\s` matches:
// RE2's own `\s` is ASCII-only ([\t\n\f\r ], and does not even include \v),
// while \p{Z} adds the Unicode separator categories (Zs/Zl/Zp -- U+00A0,
// U+2009, U+202F, U+3000 among them). \v fills the one gap \p{Z} leaves.
const aidWhitespaceClass = `[\s\p{Z}\v]`

var (
	aidLabelWhitespace = regexp.MustCompile(aidWhitespaceClass + `+`)
	aidLabelHyphen     = regexp.MustCompile(aidWhitespaceClass + `*-` + aidWhitespaceClass + `*`)
	aidLabelDashes     = strings.NewReplacer("–", "-", "—", "-", "−", "-")
)

// normalizeAidLabel is the ONE normalization for aid description keys and for
// matching an FA application's program answer to a camp_sessions name.
// CampMinder spells one grantor several ways ("X- Region", "X-Region",
// "X – Region"), so the key trims, lower-cases, unifies dashes, collapses
// whitespace and puts exactly one space either side of every hyphen. The
// whitespace classes match Python's Unicode-aware `\s` twin exactly
// (normalize_aid_label, financial_aid_ledger_service.py) -- see
// TestNormalizeAidLabel and test_normalize_aid_label_is_the_go_twin.
func normalizeAidLabel(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = aidLabelDashes.Replace(s)
	s = aidLabelWhitespace.ReplaceAllString(s, " ")
	s = aidLabelHyphen.ReplaceAllString(s, " - ")
	return strings.TrimSpace(s)
}
