package sync

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// aidSourcesConfigFileName is the PRIVATE classification file, carried in the
// kindred-local repo and symlinked into config/ exactly like
// lodging_registry.json (scripts/setup/setup-local-config.sh,
// scripts/worktree/new.sh). In production it arrives through the compose mount
// (${APPDATA_DIR}/kindred/config -> /config). It exists because the camp's own
// aid descriptions name the camp, and this repository is public.
const aidSourcesConfigFileName = "aid_sources.local.json"

// defaultAidSourcesConfigRoots is the production search order (the same as
// lodging/registry.go). Never reassigned: AidPostingsSync carries its own roots,
// so a test points one service elsewhere and still runs in parallel
// (main_test_parallelism_test.go forbids swapping package-level state).
var defaultAidSourcesConfigRoots = []string{"/config", "/app/config"}

const (
	aidClassifiedUnclassified   = "unclassified"
	aidClassifiedConfigFile     = "config_file"
	aidClassifiedStaff          = "staff"
	aidSourceFamilyUnclassified = "unclassified"
	aidFunderUnknown            = "unknown"
)

// The classified vocabularies. "unclassified" / "unknown" are not listed: only
// the transform assigns them, to a description nobody has classified yet.
var (
	aidSourceFamilies = []string{"camp_fa", "one_happy_camper", "synagogue_federation", "new_israeli", "pj",
		"jfcs", "jfam_incentive", "named_fund", "other_outside", "application_marker", "placeholder"}
	aidFunderTypes = []string{"camp", "outside", "incentive"}
)

type aidSourceEntry struct {
	Description            string   `json:"description"`
	SourceName             string   `json:"source_name"`
	SourceFamily           string   `json:"source_family"`
	FunderType             string   `json:"funder_type"`
	CountsAsAid            bool     `json:"counts_as_aid"`
	CountsTowardBudget     bool     `json:"counts_toward_budget"`
	FullCoverage           bool     `json:"full_coverage"`
	ImpliedProgramFamilies []string `json:"implied_program_families"`
}

type aidSourcesDoc struct {
	Sources []aidSourceEntry `json:"sources"`
}

type aidSourceClass struct {
	Key                string
	Description        string
	SourceName         string
	SourceFamily       string
	FunderType         string
	CountsAsAid        bool
	CountsTowardBudget bool
	FullCoverage       bool
	ImpliedFamilies    []string
}

func parseAidSourcesConfig(data []byte) (map[string]aidSourceClass, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var doc aidSourcesDoc
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", aidSourcesConfigFileName, err)
	}
	out := make(map[string]aidSourceClass, len(doc.Sources))
	for i, e := range doc.Sources {
		where := fmt.Sprintf("%s sources[%d]", aidSourcesConfigFileName, i)
		key := normalizeAidLabel(e.Description)
		switch {
		case key == "":
			return nil, fmt.Errorf("%s: description is empty", where)
		case strings.TrimSpace(e.SourceName) == "":
			return nil, fmt.Errorf("%s (%q): source_name is empty", where, e.Description)
		case !slices.Contains(aidSourceFamilies, e.SourceFamily):
			return nil, fmt.Errorf("%s (%q): unknown source_family %q", where, e.Description, e.SourceFamily)
		case !slices.Contains(aidFunderTypes, e.FunderType):
			return nil, fmt.Errorf("%s (%q): unknown funder_type %q", where, e.Description, e.FunderType)
		case e.CountsTowardBudget && e.SourceFamily != aidSourceFamilyCampFA:
			// Owner ruling 2026-09-25: every outside grant and fund is external to the
			// camp's budget; only the camp's own aid counts.
			return nil, fmt.Errorf("%s (%q): only camp_fa may count toward the budget", where, e.Description)
		case e.CountsTowardBudget && !e.CountsAsAid:
			// Item 5 ruling (final review): counting toward the budget while not
			// even counting as aid is incoherent.
			return nil, fmt.Errorf("%s (%q): counts_toward_budget requires counts_as_aid", where, e.Description)
		case e.FullCoverage && e.FunderType == "camp":
			return nil, fmt.Errorf("%s (%q): full_coverage marks an outside full-ride source, not the camp's own aid",
				where, e.Description)
		}
		for _, f := range e.ImpliedProgramFamilies {
			if !isAidProgramFamily(f) {
				return nil, fmt.Errorf("%s (%q): unknown implied program family %q", where, e.Description, f)
			}
		}
		if prev, dup := out[key]; dup {
			return nil, fmt.Errorf("%s: %q normalizes to the same key %q as %q; merge the two entries",
				where, e.Description, key, prev.Description)
		}
		implied := append([]string{}, e.ImpliedProgramFamilies...)
		sort.Strings(implied)
		out[key] = aidSourceClass{Key: key, Description: e.Description, SourceName: strings.TrimSpace(e.SourceName),
			SourceFamily: e.SourceFamily, FunderType: e.FunderType, CountsAsAid: e.CountsAsAid,
			CountsTowardBudget: e.CountsTowardBudget, FullCoverage: e.FullCoverage, ImpliedFamilies: implied}
	}
	return out, nil
}

func aidSourcesConfigCandidates(roots []string, base string) []string {
	out := make([]string, 0, len(roots)+2)
	for _, root := range roots {
		out = append(out, filepath.Join(root, aidSourcesConfigFileName))
	}
	return append(out,
		filepath.Join(base, "config", aidSourcesConfigFileName),       // from the repo root
		filepath.Join(base, "..", "config", aidSourcesConfigFileName), // from pocketbase/
	)
}

// loadAidSourcesConfig returns the classifications and the path they came from.
// explicit pins one file (an error if missing); otherwise roots, then base's
// config/ and ../config/, are searched. No file on any candidate path is not an
// error: descriptions then stay unclassified and the data-quality view lists them.
//
// candidates is always the full list this call searched, in order, whether or not
// a file was found -- so a caller whose search comes up empty (F1: prod ran for a
// season with the file simply absent from the mount, and nothing logged it) can
// name every path it looked at rather than just shrugging.
func loadAidSourcesConfig(
	explicit string, roots []string, base string,
) (classes map[string]aidSourceClass, path string, candidates []string, err error) {
	candidates = aidSourcesConfigCandidates(roots, base)
	if explicit != "" {
		candidates = []string{explicit}
	}
	for _, candidate := range candidates {
		data, readErr := os.ReadFile(candidate) //nolint:gosec // G304: trusted local config path
		if errors.Is(readErr, os.ErrNotExist) && explicit == "" {
			continue
		}
		if readErr != nil {
			return nil, "", candidates, fmt.Errorf("reading %s: %w", candidate, readErr)
		}
		parsed, parseErr := parseAidSourcesConfig(data)
		if parseErr != nil {
			return nil, "", candidates, fmt.Errorf("%s: %w", candidate, parseErr)
		}
		return parsed, candidate, candidates, nil
	}
	return nil, "", candidates, nil
}
