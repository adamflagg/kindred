package audit

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// signInMethods are the auth methods that are a person signing in. An empty
// method is a token refresh or a superuser impersonation, never a sign-in
// (apis/record_auth_refresh.go, record_auth_impersonate.go).
var signInMethods = []string{core.MFAMethodPassword, core.MFAMethodOAuth2, core.MFAMethodOTP}

func bindSignInHooks(app core.App) {
	// OnRecordAuthRequest fires once per issued token, after MFA: a password
	// step that still needs an OTP returns ErrMFA through e.Next() and is not a
	// sign-in yet; the OTP step that completes it is (spec §4.5).
	app.OnRecordAuthRequest().Bind(&hook.Handler[*core.RecordAuthRequestEvent]{
		Id:       "kindredAuditSignIn",
		Priority: hookPriority,
		Func: func(e *core.RecordAuthRequestEvent) error {
			if err := e.Next(); err != nil {
				return err //nolint:wrapcheck // the auth flow's own error
			}
			cfg, registered := configFor(e.App)
			if !registered || !slices.Contains(signInMethods, e.AuthMethod) || cfg.isService(e.Record) {
				return nil
			}
			row := Row{
				Type: TypeSignIn, Action: ActionSignIn, IP: e.RealIP(),
				Detail: map[string]any{"method": e.AuthMethod, "collection": e.Record.Collection().Name},
			}
			actorFromRecord(e.Record).apply(&row)
			writeFailOpen(e.App, &row)
			return nil
		},
	})

	// A first Pocket ID sign-in creates the account: one Access row, recorded
	// against the new person.
	app.OnRecordAuthWithOAuth2Request(usersCollection).Bind(&hook.Handler[*core.RecordAuthWithOAuth2RequestEvent]{
		Id:       "kindredAuditAccountCreated",
		Priority: hookPriority,
		Func: func(e *core.RecordAuthWithOAuth2RequestEvent) error {
			isNew := e.IsNewRecord
			if err := e.Next(); err != nil {
				return err //nolint:wrapcheck // the auth flow's own error
			}
			if !isNew || e.Record == nil {
				return nil
			}
			row := Row{
				Type: TypeAccess, Action: ActionCreate, Collection: usersCollection, RecordID: e.Record.Id,
				IP: e.RealIP(), Detail: map[string]any{"via": "first_sign_in"},
			}
			row.Before, row.After, row.Fields = changes(usersCollection, nil, snapshot(e.Record))
			row.TargetLabel, _ = targetLabel(e.App, e.Record)
			actorFromRecord(e.Record).apply(&row)
			writeFailOpen(e.App, &row)
			return nil
		},
	})
}
