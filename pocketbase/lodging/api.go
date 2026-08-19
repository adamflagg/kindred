package lodging

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/sync"
)

// RegisterRoutes mounts the roll-forward endpoints. Gated on bunking.manage
// via sync.RequirePermission, matching every lodging_* write rule — an admin
// flag would let the wrong people in and keep bunking staff out.
func RegisterRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/custom/lodging/roll-forward/preview",
		sync.RequirePermission("bunking.manage", func(re *core.RequestEvent) error {
			from, to, err := yearsFromQuery(re)
			if err != nil {
				return re.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			plan, err := PreviewRollForward(re.App, from, to)
			if err != nil {
				return re.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			return re.JSON(http.StatusOK, plan)
		}))

	e.Router.POST("/api/custom/lodging/roll-forward",
		sync.RequirePermission("bunking.manage", func(re *core.RequestEvent) error {
			from, to, err := yearsFromQuery(re)
			if err != nil {
				return re.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			plan, err := ApplyRollForward(re.App, from, to)
			if err != nil {
				return re.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
			}
			return re.JSON(http.StatusOK, plan)
		}))

	// The Family Camp roster export (kindred#2433). Synchronous: a handful of
	// Google calls, not a sync run. It APPENDS a dated tab and never prunes or
	// overwrites one, because staff hand-edit every tab.
	e.Router.POST("/api/custom/lodging/roster-export",
		sync.RequirePermission("bunking.manage", func(re *core.RequestEvent) error {
			year, sessionCMID, err := rosterExportParams(re)
			if err != nil {
				return re.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}

			ctx := re.Request.Context()
			exporter, err := sync.NewRosterExporterForApp(ctx, re.App)
			if err != nil {
				return re.JSON(rosterExportStatus(err), map[string]string{"error": err.Error()})
			}

			result, err := exporter.Export(ctx, year, sessionCMID)
			if err != nil {
				return re.JSON(rosterExportStatus(err), map[string]string{"error": err.Error()})
			}
			return re.JSON(http.StatusOK, result)
		}))
}

// The bounds `year` actually carries (1500000141). Validating against them here
// rather than letting app.Save discover them is what keeps a client error a 400:
// the POST handler reports a failed apply as a 500, so an out-of-range `to`
// would otherwise surface as a server fault naming a field the caller never
// mentioned. The upper bound is the half that is easy to skip and worth keeping
// — a typo like `to=2099` is inside the field range, so it would succeed and
// create the phantom season registry.go warns about.
const (
	minSeasonYear = 2010
	maxSeasonYear = 2100
)

func yearsFromQuery(re *core.RequestEvent) (from, to int, err error) {
	from, err = seasonYear(re, "from")
	if err != nil {
		return 0, 0, err
	}
	to, err = seasonYear(re, "to")
	if err != nil {
		return 0, 0, err
	}
	return from, to, nil
}

func seasonYear(re *core.RequestEvent, name string) (int, error) {
	year, err := strconv.Atoi(re.Request.URL.Query().Get(name))
	if err != nil || year < minSeasonYear || year > maxSeasonYear {
		return 0, fmt.Errorf("%s must be a year between %d and %d", name, minSeasonYear, maxSeasonYear)
	}
	return year, nil
}

// rosterExportParams reads ?year=&session= for the roster export.
//
// Validated here rather than left to the builder so a client error stays a 400:
// a mistyped year otherwise reaches camp_sessions, matches nothing, and comes
// back as a 404 naming a session id the caller got right.
func rosterExportParams(re *core.RequestEvent) (year, sessionCMID int, err error) {
	year, err = seasonYear(re, "year")
	if err != nil {
		return 0, 0, err
	}
	// A CampMinder session id is always positive, and 0 is what Atoi yields for
	// a missing parameter -- so the bound catches both.
	sessionCMID, err = strconv.Atoi(re.Request.URL.Query().Get("session"))
	if err != nil || sessionCMID <= 0 {
		return 0, 0, fmt.Errorf("session must be a positive CampMinder session id")
	}
	return year, sessionCMID, nil
}

// rosterExportStatus maps an export failure onto a status code.
//
// The refusals are not server faults. A weekend with no enrolled campers, or one
// that is not a Family Camp weekend, is something staff can legitimately ask for
// and must be told about plainly -- reporting either as a 500 reads as "the
// export is broken" and sends them looking in the wrong place. A missing
// GOOGLE_DRIVE_ROSTER_FOLDER_ID is the opposite: nothing the caller did.
//
// errors.Is, not equality: every refusal reaches here wrapped by the builder.
func rosterExportStatus(err error) int {
	switch {
	case errors.Is(err, sync.ErrRosterSessionNotFound):
		return http.StatusNotFound
	case errors.Is(err, sync.ErrRosterSessionNotFamily),
		errors.Is(err, sync.ErrRosterNoEnrolledCampers):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}
