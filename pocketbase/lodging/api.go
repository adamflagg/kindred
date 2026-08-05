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

func yearsFromQuery(re *core.RequestEvent) (from, to int, err error) {
	from, err = strconv.Atoi(re.Request.URL.Query().Get("from"))
	if err != nil {
		return 0, 0, fmt.Errorf("from must be a year")
	}
	to, err = strconv.Atoi(re.Request.URL.Query().Get("to"))
	if err != nil {
		return 0, 0, fmt.Errorf("to must be a year")
	}
	return from, to, nil
}
