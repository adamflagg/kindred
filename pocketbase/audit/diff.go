package audit

import (
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Size caps for before and after (spec §5: each capped at 20 KB, with a
// truncation marker). One value over maxValueBytes is replaced by a marker
// string; keys that would take a side over maxSideBytes are dropped and named
// under TruncatedKey.
const (
	maxValueBytes = 4 << 10
	maxSideBytes  = 20 << 10
	// TruncatedKey lists the fields dropped from an over-size side.
	TruncatedKey = "_truncated"
	// RedactedValue replaces every denylisted value.
	RedactedValue = "[redacted]"
)

// redactedKeys is the ONE denylist (spec §5 "never stored"), matched
// case-insensitively against a key, or the last segment of a dotted settings
// path. Passwords (a record's password field reads as its bcrypt hash here, and
// a just-set password would otherwise read as PLAIN TEXT through Record.Get),
// token keys, and every OAuth2, SMTP, S3 and token-signing secret: PocketBase
// names those `secret`, `clientSecret` and `password`. TestRedactedKeys pins it.
var redactedKeys = []string{
	"clientsecret",
	"oldpassword",
	"password",
	"passwordconfirm",
	"passwordhash",
	"secret",
	"tokenkey",
}

// derivedFields are dropped from every diff: derived, so they would be noise
// (spec §5: users.cached_permissions; users.last_seen is stamped on every
// session refresh, spec 2026-10-01-users-page-uplift-design §3.5).
// households.aid_adults is sync-derived too, and names people for Camperships
// only (sync/aid_adults.go): an admin's household edit must not copy those
// names into the audit log.
var derivedFields = map[string][]string{
	usersCollection: {"cached_permissions", "last_seen"},
	"households":    {"aid_adults"},
}

// snapshot is a record's field values as plain JSON types, without id and
// autodate fields. A password field contributes its HASH: comparing hashes
// detects a change without ever holding the plain text (Record.Get returns the
// plain password a request just set; core/field_password.go FindGetter).
func snapshot(record *core.Record) map[string]any {
	out := map[string]any{}
	for _, field := range record.Collection().Fields {
		name := field.GetName()
		switch {
		case name == core.FieldNameId, field.Type() == core.FieldTypeAutodate:
			continue
		case field.Type() == core.FieldTypePassword:
			out[name] = record.GetString(name + ":hash")
		default:
			out[name] = plain(record.Get(name))
		}
	}
	return out
}

// plain round-trips v through JSON so types.DateTime, types.JSONRaw and typed
// slices compare as the strings, maps and []any they serialize to.
func plain(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return string(raw)
	}
	return out
}

// changes turns two snapshots into the stored before/after and the changed
// field names. A create (before nil) keeps only after's non-empty values; a
// delete (after nil) keeps the full before; an update keeps only the fields that
// differ. Both sides are redacted, then capped. An update that changed nothing
// returns no fields, and the caller writes no row.
func changes(collection string, before, after map[string]any) (b, a map[string]any, fields []string) {
	before, after = withoutDerived(collection, before), withoutDerived(collection, after)
	switch {
	case before == nil && after == nil:
		return nil, nil, nil
	case before == nil:
		a = map[string]any{}
		for k, v := range after {
			if !isEmpty(v) {
				a[k] = v
				fields = append(fields, k)
			}
		}
	case after == nil:
		b = maps.Clone(before)
		fields = slices.Collect(maps.Keys(before))
	default:
		b, a = map[string]any{}, map[string]any{}
		for k := range union(before, after) {
			if !reflect.DeepEqual(before[k], after[k]) {
				b[k], a[k] = before[k], after[k]
				fields = append(fields, k)
			}
		}
	}
	slices.Sort(fields)
	return capSide(redact(b)), capSide(redact(a)), fields
}

func withoutDerived(collection string, m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := maps.Clone(m)
	for _, name := range derivedFields[collection] {
		delete(out, name)
	}
	return out
}

func union(a, b map[string]any) map[string]struct{} {
	keys := map[string]struct{}{}
	for k := range a {
		keys[k] = struct{}{}
	}
	for k := range b {
		keys[k] = struct{}{}
	}
	return keys
}

func isEmpty(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string:
		return x == ""
	case bool:
		return !x
	case float64:
		return x == 0
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}

// isRedactedKey matches a key, or a dotted path's last segment, to the denylist.
func isRedactedKey(key string) bool {
	if i := strings.LastIndex(key, "."); i >= 0 {
		key = key[i+1:]
	}
	return slices.Contains(redactedKeys, strings.ToLower(key))
}

// redact replaces every denylisted value, at any depth, with RedactedValue.
// The key stays, so "the password changed" is still visible.
func redact(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		if isRedactedKey(k) {
			out[k] = RedactedValue
			continue
		}
		out[k] = redactValue(v)
	}
	return out
}

func redactValue(v any) any {
	switch x := v.(type) {
	case map[string]any:
		return redact(x)
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = redactValue(item)
		}
		return out
	}
	return v
}

// capSide applies the size caps to one side, keys in sorted order.
func capSide(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	keys := slices.Sorted(maps.Keys(m))
	out := map[string]any{}
	size := 2 // the braces
	var dropped []string
	for _, k := range keys {
		v := m[k]
		raw, _ := json.Marshal(v)
		if len(raw) > maxValueBytes {
			v = fmt.Sprintf("[truncated: %d bytes]", len(raw))
			raw, _ = json.Marshal(v)
		}
		entry := len(raw) + len(k) + 4 // quotes, colon, comma
		if size+entry > maxSideBytes {
			dropped = append(dropped, k)
			continue
		}
		out[k] = v
		size += entry
	}
	if len(dropped) > 0 {
		out[TruncatedKey] = dropped
	}
	return out
}

// flatten turns a nested JSON value into dotted paths ("smtp.password"), for
// settings diffs. Arrays stay whole values.
func flatten(prefix string, v any, out map[string]any) {
	m, ok := v.(map[string]any)
	if !ok || len(m) == 0 {
		if prefix != "" {
			out[prefix] = v
		}
		return
	}
	for k, child := range m {
		path := k
		if prefix != "" {
			path = prefix + "." + k
		}
		flatten(path, child, out)
	}
}

// flatJSON is flatten over any JSON-marshalable value.
func flatJSON(v any) map[string]any {
	out := map[string]any{}
	flatten("", plain(v), out)
	return out
}
