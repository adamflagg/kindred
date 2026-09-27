package audit

import (
	"bytes"
	"encoding/json"
	"reflect"
	"slices"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// ---------------------------------------------------------------------------
// The collection itself: only migrations may change it (spec §5)
// ---------------------------------------------------------------------------

func bindCollectionGuards(app core.App) {
	refuseCollection := &hook.Handler[*core.CollectionRequestEvent]{
		Id:       "kindredAuditAppendOnlyCollection",
		Priority: guardPriority,
		Func: func(e *core.CollectionRequestEvent) error {
			if isAuditCollection(e.App, e.Collection) {
				return apis.NewBadRequestError(appendOnlyMessage, nil)
			}
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		},
	}
	app.OnCollectionUpdateRequest().Bind(refuseCollection)
	app.OnCollectionDeleteRequest().Bind(refuseCollection)
}

// isAuditCollection matches by name or by the stored collection's id, so a
// request that renames the collection in its body is still caught.
func isAuditCollection(app core.App, c *core.Collection) bool {
	if c == nil {
		return false
	}
	if c.Name == CollectionName {
		return true
	}
	stored, err := app.FindCachedCollectionByNameOrId(CollectionName)
	return err == nil && stored.Id == c.Id
}

// ---------------------------------------------------------------------------
// Collection schema and app settings requests: always PB Admin (spec §4.2)
// ---------------------------------------------------------------------------

func bindSchemaAndSettingsHooks(app core.App) {
	bindCollectionGuards(app)
	collectionHook := func(operation string) *hook.Handler[*core.CollectionRequestEvent] {
		return &hook.Handler[*core.CollectionRequestEvent]{
			Id:       "kindredAuditCollection_" + operation,
			Priority: hookPriority,
			Func:     func(e *core.CollectionRequestEvent) error { return auditCollectionRequest(e, operation) },
		}
	}
	app.OnCollectionCreateRequest().Bind(collectionHook(ActionCreate))
	app.OnCollectionUpdateRequest().Bind(collectionHook(ActionUpdate))
	app.OnCollectionDeleteRequest().Bind(collectionHook(ActionDelete))
	app.OnCollectionsImportRequest().Bind(&hook.Handler[*core.CollectionsImportRequestEvent]{
		Id:       "kindredAuditCollectionsImport",
		Priority: hookPriority,
		Func:     auditCollectionsImport,
	})
	app.OnSettingsUpdateRequest().Bind(&hook.Handler[*core.SettingsUpdateRequestEvent]{
		Id:       "kindredAuditSettings",
		Priority: hookPriority,
		Func:     auditSettingsUpdate,
	})
}

func auditCollectionRequest(e *core.CollectionRequestEvent, operation string) error {
	cfg, registered := configFor(e.App)
	if !registered {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	actor, ok := resolveActor(e.RequestEvent, cfg)
	if !ok {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	var before map[string]any
	if operation != ActionCreate {
		// collectionUpdate binds the body onto e.Collection; this is the stored one.
		if stored, err := e.App.FindCollectionByNameOrId(e.Collection.Id); err == nil {
			before = collectionSnapshot(stored)
		}
	}
	return inTransaction(e.RequestEvent, func(txApp core.App) error {
		if err := e.Next(); err != nil {
			return err //nolint:wrapcheck // a refusal from the chain, returned as is
		}
		var after map[string]any
		if operation != ActionDelete {
			after = collectionSnapshot(e.Collection)
		}
		row := Row{
			Type: TypePBAdmin, Action: ActionSchemaChange, Collection: e.Collection.Name,
			RecordID: e.Collection.Id, TargetLabel: e.Collection.Name, IP: e.RealIP(),
			Detail: fieldChanges(before, after),
		}
		row.Detail["operation"] = operation
		row.Before, row.After, row.Fields = changes("", before, after)
		actor.apply(&row)
		return writeFailClosed(txApp, &row)
	})
}

// collectionSnapshot is a collection's JSON without its timestamps.
func collectionSnapshot(c *core.Collection) map[string]any {
	m, _ := plain(c).(map[string]any)
	delete(m, "created")
	delete(m, "updated")
	return m
}

// fieldChanges names the fields a schema change added, removed or changed, so
// the screen can say so without reading the whole fields array.
func fieldChanges(before, after map[string]any) map[string]any {
	byName := func(side map[string]any) map[string]any {
		out := map[string]any{}
		list, _ := side["fields"].([]any)
		for _, f := range list {
			if m, ok := f.(map[string]any); ok {
				if name, ok := m["name"].(string); ok {
					out[name] = m
				}
			}
		}
		return out
	}
	b, a := byName(before), byName(after)
	var added, removed, changed []string
	for name, field := range a {
		old, existed := b[name]
		switch {
		case !existed:
			added = append(added, name)
		case !reflect.DeepEqual(old, field):
			changed = append(changed, name)
		}
	}
	for name := range b {
		if _, kept := a[name]; !kept {
			removed = append(removed, name)
		}
	}
	detail := map[string]any{}
	lists := map[string][]string{"fields_added": added, "fields_removed": removed, "fields_changed": changed}
	for key, names := range lists {
		if len(names) > 0 {
			slices.Sort(names)
			detail[key] = names
		}
	}
	return detail
}

// auditCollectionsImport logs an import and refuses one that would change or
// delete the audit log (an import can do both: deleteMissing, or a changed
// definition). The check runs after the import, inside the same transaction,
// so a refused import leaves nothing behind.
func auditCollectionsImport(e *core.CollectionsImportRequestEvent) error {
	cfg, registered := configFor(e.App)
	if !registered {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	var fingerprint []byte
	if stored, err := e.App.FindCollectionByNameOrId(CollectionName); err == nil {
		fingerprint, _ = json.Marshal(collectionSnapshot(stored))
	}
	return inTransaction(e.RequestEvent, func(txApp core.App) error {
		if err := e.Next(); err != nil {
			return err //nolint:wrapcheck // a refusal from the chain, returned as is
		}
		if fingerprint != nil {
			after, err := txApp.FindCollectionByNameOrId(CollectionName)
			if err != nil {
				return apis.NewBadRequestError(appendOnlyMessage, nil)
			}
			if now, _ := json.Marshal(collectionSnapshot(after)); !bytes.Equal(now, fingerprint) {
				return apis.NewBadRequestError(appendOnlyMessage, nil)
			}
		}
		actor, ok := resolveActor(e.RequestEvent, cfg)
		if !ok {
			return nil
		}
		names := make([]string, 0, len(e.CollectionsData))
		for _, c := range e.CollectionsData {
			if name, ok := c["name"].(string); ok {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		row := Row{
			Type: TypePBAdmin, Action: ActionSchemaChange, TargetLabel: "collections import", IP: e.RealIP(),
			Detail: map[string]any{"operation": "import", "collections": names, "delete_missing": e.DeleteMissing},
		}
		actor.apply(&row)
		return writeFailClosed(txApp, &row)
	})
}

func auditSettingsUpdate(e *core.SettingsUpdateRequestEvent) error {
	cfg, registered := configFor(e.App)
	if !registered {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	actor, ok := resolveActor(e.RequestEvent, cfg)
	if !ok {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	return inTransaction(e.RequestEvent, func(txApp core.App) error {
		if err := e.Next(); err != nil {
			return err //nolint:wrapcheck // a refusal from the chain, returned as is
		}
		before, after := flatJSON(e.OldSettings), flatJSON(e.NewSettings)
		row := Row{Type: TypePBAdmin, Action: ActionSettingsChange, TargetLabel: "PocketBase settings", IP: e.RealIP()}
		row.Before, row.After, row.Fields = changes("", before, after)
		if len(row.Fields) == 0 {
			return nil
		}
		actor.apply(&row)
		return writeFailClosed(txApp, &row)
	})
}
