// Package aidform holds the pure logic of the adult aid Google Form ingest
// (adult-aid form design, PR 1): reading the form's free-text figures, mapping
// its questions and program choices, and matching a response to a person.
// Nothing here touches the database or the network; the sync job
// (pocketbase/sync/aid_google_form_responses.go) feeds it and writes what it
// decides.
package aidform

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// FigureKind says what a blank and a monthly figure mean for one question.
type FigureKind int

const (
	// FigureRequired: a blank is unknown ("left blank"), and a monthly figure is
	// unknown too. Income, savings, medical, student loans and the ask.
	FigureRequired FigureKind = iota
	// FigureOptionalHousing: the two "leave blank if not" questions (rent,
	// mortgage). A blank is 0 and not reported; a monthly figure is read ×12,
	// with a note, since neither is priced.
	FigureOptionalHousing
)

// Figure is one figure as Kindred read it. Unknown is never 0: Known false
// always comes with Value 0 and a Note, and a reader must treat Value as absent.
type Figure struct {
	Value float64
	// Known: Value is the family's figure (0 included).
	Known bool
	// Reported: the family typed something that reads as a figure (0
	// included). A blank optional question is Known 0 but not Reported.
	Reported bool
	// Note is "" when the figure was read cleanly, otherwise what staff see.
	Note string
}

// The note texts staff see on the opened row (design §7).
const (
	NoteBlank       = "left blank"
	NoteRange       = "a range: not read"
	NoteMonthly     = "monthly: not read"
	NoteNotDollars  = "not a dollar amount"
	NoteNotNumber   = "not a number"
	NoteNegative    = "negative"
	NoteSeveralNums = "several numbers: not read"
)

var (
	spaceRun = regexp.MustCompile(`\s+`)
	// A number as typed: digits with optional grouping commas and decimals,
	// and an optional multiplier written right after it.
	numberToken = regexp.MustCompile(`\d[\d,]*(?:\.\d+)?|\.\d+`)
	monthlyRe   = regexp.MustCompile(
		`/\s*(?:mo|mon|mth|month)\.?\b|\bper\s+(?:mo|mon|mth|month)\.?\b|\ba\s+month\b|\beach\s+month\b|\bmonthly\b`)
	yearlyRe  = regexp.MustCompile(`/\s*(?:yr|year)\b|\bper\s+(?:yr|year)\b|\ba\s+year\b|\byearly\b|\bannually\b`)
	betweenRe = regexp.MustCompile(`\bbetween\b.*\d.*\band\b.*\d`)
	// Two numbers joined by a dash or "to": "1000-1500", "70k – 80k", "$70,000 to $80,000".
	rangeRe = regexp.MustCompile(
		`\d[\d,.]*\s*(?:k|m)?\s*(?:-|–|—|\bto\b)\s*\$?\s*\d`)
	hedgeLead = regexp.MustCompile(
		`^(?:approximately|approx\.?|appx\.?|about|around|roughly|circa|ca\.|estimated|estimate|est\.?|~)\s*`)
	hedgeTrail    = regexp.MustCompile(`(?:ish|\+|\s+or\s+so)$`)
	currencyWords = regexp.MustCompile(`\busd\b|\bdollars?\b|\$`)
	// What is left once a figure's words are stripped: the number and an optional multiplier.
	bareFigure  = regexp.MustCompile(`^(\d+(?:\.\d+)?|\.\d+)(k|m|thousand|mil|million)?$`)
	numberWords = regexp.MustCompile(
		`\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|` +
			`sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|` +
			`hundred|thousand|million)\b`)
)

// zeroWords read as a reported 0.
var zeroWords = map[string]bool{
	"none": true, "n/a": true, "na": true, "n.a.": true, "-": true, "--": true, "–": true, "—": true,
	"nothing": true, "zero": true, "no": true, "nil": true,
}

// ParseFigure reads one typed figure (design §7, GF-5 = A). A hedged figure
// ("about 85k", "~1,000", "1.2k") reads as that number with a note; a range,
// a percentage, words, a negative and a monthly income stay unknown with a
// note. It never guesses a point inside a range.
func ParseFigure(typed string, kind FigureKind) Figure {
	raw := strings.TrimSpace(typed)
	if raw == "" {
		if kind == FigureOptionalHousing {
			return Figure{Known: true}
		}
		return unknown(NoteBlank)
	}
	s := spaceRun.ReplaceAllString(strings.ToLower(raw), " ")
	if zeroWords[s] {
		return Figure{Known: true, Reported: true}
	}
	if strings.Contains(s, "%") {
		return unknown(NoteNotDollars)
	}
	if strings.HasPrefix(s, "-") || strings.HasPrefix(s, "−") || strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		if numberToken.MatchString(s) {
			return unknown(NoteNegative)
		}
	}
	if betweenRe.MatchString(s) || rangeRe.MatchString(s) {
		return unknown(NoteRange)
	}

	monthly := monthlyRe.MatchString(s)
	s = monthlyRe.ReplaceAllString(s, " ")
	s = yearlyRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)

	hedged := false
	for {
		trimmed := strings.TrimSpace(hedgeLead.ReplaceAllString(s, ""))
		if trimmed == s {
			break
		}
		s, hedged = trimmed, true
	}
	if hedgeTrail.MatchString(s) {
		s, hedged = strings.TrimSpace(hedgeTrail.ReplaceAllString(s, "")), true
	}

	s = currencyWords.ReplaceAllString(s, " ")
	if len(numberToken.FindAllString(s, -1)) > 1 && !groupedNumber(s) {
		return unknown(NoteSeveralNums)
	}
	compact := strings.ReplaceAll(strings.ReplaceAll(s, ",", ""), " ", "")
	m := bareFigure.FindStringSubmatch(compact)
	if m == nil {
		return unknownWords(s)
	}
	value, err := strconv.ParseFloat(m[1], 64)
	if err != nil || math.IsInf(value, 0) || math.IsNaN(value) {
		return unknown(NoteNotNumber)
	}
	switch m[2] {
	case "k", "thousand":
		value, hedged = value*1000, true
	case "m", "mil", "million":
		value, hedged = value*1_000_000, true
	}
	value = math.Round(value*100) / 100

	var notes []string
	if hedged {
		notes = append(notes, fmt.Sprintf("read '%s' as %s", raw, Money(value)))
	}
	if monthly {
		if kind != FigureOptionalHousing {
			return unknown(NoteMonthly)
		}
		value = math.Round(value*12*100) / 100
		notes = append(notes, fmt.Sprintf("monthly: ×12 = %s", Money(value)))
	}
	return Figure{Value: value, Known: true, Reported: true, Note: strings.Join(notes, "; ")}
}

// groupedNumber is a single number written with spaces inside its grouping
// ("1 200"), which numberToken sees as two.
func groupedNumber(s string) bool { return spacedGroups.MatchString(s) }

var spacedGroups = regexp.MustCompile(`^\s*\d{1,3}(?: \d{3})+(?:\.\d+)?\s*$`)

func unknown(note string) Figure { return Figure{Note: note} }

// unknownWords names why a figure with no readable number was not read.
func unknownWords(s string) Figure {
	if numberToken.MatchString(s) || numberWords.MatchString(s) {
		return unknown(NoteNotNumber)
	}
	return unknown(NoteNotDollars)
}

// Money renders a figure as staff read it: "$1,000", "$1,234.56".
func Money(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	whole := int64(v)
	cents := int64(math.Round((v - float64(whole)) * 100))
	if cents == 100 {
		whole, cents = whole+1, 0
	}
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	out := "$" + b.String()
	if cents != 0 {
		out += fmt.Sprintf(".%02d", cents)
	}
	if neg {
		out = "-" + out
	}
	return out
}

// maxCount is financial_aid_applications.num_children's own maximum.
const maxCount = 50

var (
	countWords = map[string]int{
		"zero": 0, "none": 0, "no": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
		"seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
	}
	countRe = regexp.MustCompile(`^([a-z]+|\d+)(?:\s+(?:kids?|children|child|dependents?|people|persons?))?$`)
)

// ParseCount reads the dependents answer: "2", "two", "0", "none", "2 kids".
// Anything else is unknown, with a note.
func ParseCount(typed string) (int, bool, string) {
	s := spaceRun.ReplaceAllString(strings.ToLower(strings.TrimSpace(typed)), " ")
	if s == "" {
		return 0, false, NoteBlank
	}
	m := countRe.FindStringSubmatch(s)
	if m == nil {
		return 0, false, NoteNotNumber
	}
	if n, ok := countWords[m[1]]; ok {
		return n, true, ""
	}
	n, err := strconv.Atoi(m[1])
	if err != nil || n < 0 || n > maxCount {
		return 0, false, NoteNotNumber
	}
	return n, true, ""
}

// ParseYesNo reads a Yes/No choice. ok is false for a blank or any other answer.
func ParseYesNo(typed string) (value, ok bool) {
	switch strings.ToLower(strings.TrimSpace(typed)) {
	case "yes":
		return true, true
	case "no":
		return false, true
	}
	return false, false
}

// NormalizeDate returns a Forms date answer ("YYYY-MM-DD") as is, or "" when it
// is not one.
func NormalizeDate(typed string) string {
	s := strings.TrimSpace(typed)
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return ""
	}
	return s
}
