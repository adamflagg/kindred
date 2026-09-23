package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// kindred#2779: grades below kindergarten, and "no grade" stored explicitly.
//
// CampMinder's CampGradeID runs Infant -3 .. 12th+ 14, with Pre-K at 0. The
// sync used to treat 0 as missing, so Pre-K fell back to the school grade and
// everything younger was dropped. `grade` is now `id - 1` for every id, and
// `grade_name` carries CampGradeName -- empty when CampMinder has no grade.

func gradePersonData(camperDetails map[string]any) map[string]any {
	return map[string]any{
		"ID":            float64(12345),
		"Name":          map[string]any{"First": testFirstName, "Last": "Johnson"},
		"CamperDetails": camperDetails,
	}
}

func TestTransformPersonToPB_GradeMapsEveryCampGradeID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		id        float64
		name      string
		wantGrade int
	}{
		{-3, "Infant", -4},
		{-2, "Toddler", -3},
		{-1, "Nursery", -2},
		{0, "Pre-K", -1},
		{1, "K", 0},
		{2, "1st", 1},
		{7, "6th", 6},
		{13, "12th", 12},
		{14, "12th+", 13},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := &PersonsSync{missingDataStats: make(map[string]int)}
			pbData, err := s.transformPersonToPB(gradePersonData(map[string]any{
				"CampGradeID":   tc.id,
				"CampGradeName": tc.name,
			}), 2026, true)
			if err != nil {
				t.Fatalf("transformPersonToPB: %v", err)
			}
			if got := pbData["grade"]; got != tc.wantGrade {
				t.Errorf("grade = %v, want %d", got, tc.wantGrade)
			}
			if got := pbData["grade_name"]; got != tc.name {
				t.Errorf("grade_name = %v, want %q", got, tc.name)
			}
		})
	}
}

// Measured 2026-09-23: one enrolled 2026 child carries CampGradeID 0 (Pre-K)
// beside SchoolGradeID 1 (K). The camp grade wins, as it does at every other id.
func TestTransformPersonToPB_PreKDoesNotFallBackToSchoolGrade(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{missingDataStats: make(map[string]int)}
	pbData, err := s.transformPersonToPB(gradePersonData(map[string]any{
		"CampGradeID":     float64(0),
		"CampGradeName":   "Pre-K",
		"SchoolGradeID":   float64(1),
		"SchoolGradeName": "K",
	}), 2026, true)
	if err != nil {
		t.Fatalf("transformPersonToPB: %v", err)
	}
	if got := pbData["grade"]; got != -1 {
		t.Errorf("grade = %v, want -1 (Pre-K), not the school grade", got)
	}
	if got := pbData["grade_name"]; got != "Pre-K" {
		t.Errorf("grade_name = %v, want \"Pre-K\"", got)
	}
}

// Only an ABSENT camp grade falls back to the school grade, and the name comes
// with it so the two fields never describe different grades.
func TestTransformPersonToPB_AbsentCampGradeFallsBackToSchoolGrade(t *testing.T) {
	t.Parallel()
	s := &PersonsSync{missingDataStats: make(map[string]int)}
	pbData, err := s.transformPersonToPB(gradePersonData(map[string]any{
		"CampGradeID":     nil,
		"CampGradeName":   "",
		"SchoolGradeID":   float64(5),
		"SchoolGradeName": "4th",
	}), 2026, true)
	if err != nil {
		t.Fatalf("transformPersonToPB: %v", err)
	}
	if got := pbData["grade"]; got != 4 {
		t.Errorf("grade = %v, want 4", got)
	}
	if got := pbData["grade_name"]; got != "4th" {
		t.Errorf("grade_name = %v, want \"4th\"", got)
	}
}

// Adults come through with a null grade and an empty name (196 of 2026's
// enrolled people), occasionally with the name "Unknown" (1). Both write grade
// 0 and an empty grade_name -- explicitly, so a stale grade is overwritten.
func TestTransformPersonToPB_NoGradeWritesZeroAndEmptyName(t *testing.T) {
	t.Parallel()
	cases := map[string]map[string]any{
		"null grade, empty name": {
			"CampGradeID": nil, "CampGradeName": "", "SchoolGradeID": nil, "SchoolGradeName": "",
		},
		"null grade, Unknown": {
			"CampGradeID": nil, "CampGradeName": "Unknown", "SchoolGradeID": nil, "SchoolGradeName": "Unknown",
		},
		"keys absent": {},
	}
	for name, details := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			s := &PersonsSync{missingDataStats: make(map[string]int)}
			pbData, err := s.transformPersonToPB(gradePersonData(details), 2026, true)
			if err != nil {
				t.Fatalf("transformPersonToPB: %v", err)
			}
			if got, ok := pbData["grade"]; !ok || got != 0 {
				t.Errorf("grade = %v (present=%v), want an explicit 0", got, ok)
			}
			if got, ok := pbData["grade_name"]; !ok || got != "" {
				t.Errorf("grade_name = %v (present=%v), want an explicit \"\"", got, ok)
			}
			if got := s.missingDataStats["missing_grade"]; got != 1 {
				t.Errorf("missing_grade = %d, want 1", got)
			}
		})
	}
}

// A correction in CampMinder down to Pre-K used to be skipped entirely: no
// grade was written, so the update loop never compared the field.
func TestProcessPerson_GradeCorrectionToPreKOverwrites(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("persons")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})
	col.Fields.Add(&core.NumberField{Name: "year"})
	col.Fields.Add(&core.BoolField{Name: "is_camper"})
	col.Fields.Add(&core.NumberField{Name: "grade"})
	col.Fields.Add(&core.TextField{Name: "grade_name"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	existing := core.NewRecord(col)
	existing.Set("cm_id", 12345)
	existing.Set("year", 2026)
	existing.Set("first_name", testFirstName)
	existing.Set("last_name", "Johnson")
	existing.Set("is_camper", true)
	existing.Set("grade", 1)
	existing.Set("grade_name", "1st")
	if saveErr := app.Save(existing); saveErr != nil {
		t.Fatalf("seed person: %v", saveErr)
	}

	s := NewPersonsSync(app, nil)
	personData := gradePersonData(map[string]any{"CampGradeID": float64(0), "CampGradeName": "Pre-K"})
	if procErr := s.processPerson(
		personData, true, map[int]*core.Record{12345: existing},
		map[string]string{}, map[int]string{}, 2026,
	); procErr != nil {
		t.Fatalf("processPerson: %v", procErr)
	}

	got, err := app.FindFirstRecordByFilter("persons", "cm_id = 12345")
	if err != nil {
		t.Fatalf("find person: %v", err)
	}
	if g := got.GetInt("grade"); g != -1 {
		t.Errorf("grade = %d, want -1 -- the correction to Pre-K did not overwrite", g)
	}
	if n := got.GetString("grade_name"); n != "Pre-K" {
		t.Errorf("grade_name = %q, want \"Pre-K\"", n)
	}
}

// The Persons sheet carries grade_name beside the number: after kindred#2779
// the number reads -1..-4 below K and 0 for both K and "no grade", which only
// the name tells apart.
func TestReadablePersonsExport_HasGradeNameBesideGrade(t *testing.T) {
	t.Parallel()
	for _, cfg := range GetReadableYearExports() {
		if cfg.SheetName != "Persons" {
			continue
		}
		for i, col := range cfg.Columns {
			if col.Field != "grade" {
				continue
			}
			if i+1 >= len(cfg.Columns) {
				t.Fatalf("no column after grade")
			}
			next := cfg.Columns[i+1]
			if next.Field != "grade_name" || next.Header != "Grade Name" || next.Type != FieldTypeText {
				t.Errorf("column after grade = %+v, want grade_name / \"Grade Name\" / text", next)
			}
			return
		}
		t.Fatalf("Persons export has no grade column")
	}
	t.Fatalf("no Persons export config")
}
