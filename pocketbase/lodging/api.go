package lodging

import (
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
