# PocketBase v0.23+ Field Type Reference

All properties are **direct** on the field object. Never wrap in `options: {}`.

## Field Types

### text
```javascript
{
  type: "text",
  name: "field_name",
  required: false,
  presentable: false,
  min: 0,          // minimum length (0 = no minimum)
  max: 200,        // maximum length (0 = unlimited)
  pattern: ""      // regex pattern ("" = no pattern)
}
```

### number
```javascript
{
  type: "number",
  name: "field_name",
  required: false,
  presentable: false,
  min: null,       // minimum value (null = no limit) — NOT 0, which means "minimum of 0"
  max: null,       // maximum value (null = no limit) — NOT 0, which means "maximum of 0"
  onlyInt: false   // true = integers only
}
```
**Gotcha**: `min: 0, max: 0` on a number field means "value must be exactly 0". Use `null` for unbounded.

### select
```javascript
{
  type: "select",
  name: "field_name",
  required: false,
  presentable: false,
  values: ["option_a", "option_b", "option_c"],
  maxSelect: 1     // 1 = single select, >1 = multi-select
}
```

### relation
```javascript
{
  type: "relation",
  name: "field_name",
  required: false,
  presentable: false,
  collectionId: targetCol.id,  // use app.findCollectionByNameOrId("name").id
  cascadeDelete: false,
  minSelect: null,
  maxSelect: 1     // 1 = single relation, null or >1 = multiple
}
```
**Gotcha**: Always look up `collectionId` dynamically. Never hardcode.

### bool
```javascript
{
  type: "bool",
  name: "field_name",
  required: false,
  presentable: false
}
```

### json
```javascript
{
  type: "json",
  name: "field_name",
  required: false,
  presentable: false,
  maxSize: 2000000  // in bytes (0 = use PocketBase default)
}
```

### file
```javascript
{
  type: "file",
  name: "field_name",
  required: false,
  presentable: false,
  maxSelect: 1,
  maxSize: 5242880,    // 5MB in bytes
  mimeTypes: [],       // empty = allow all
  thumbs: []           // thumbnail sizes
}
```

### date
```javascript
{
  type: "date",
  name: "field_name",
  required: false,
  presentable: false,
  min: "",   // ISO date string or "" for no limit
  max: ""    // ISO date string or "" for no limit
}
```

### autodate
```javascript
{
  type: "autodate",
  name: "created",    // typically "created" or "updated"
  required: false,
  presentable: false,
  onCreate: true,
  onUpdate: false     // true for "updated" fields
}
```

### email
```javascript
{
  type: "email",
  name: "field_name",
  required: false,
  presentable: false,
  exceptDomains: [],   // blocked domains
  onlyDomains: []      // allowed domains (empty = all)
}
```

### url
```javascript
{
  type: "url",
  name: "field_name",
  required: false,
  presentable: false,
  exceptDomains: [],
  onlyDomains: []
}
```

### editor
```javascript
{
  type: "editor",
  name: "field_name",
  required: false,
  presentable: false,
  maxSize: 0,           // 0 = default
  convertUrls: false
}
```

## Common Property Notes

| Property | Applies to | Notes |
|----------|-----------|-------|
| `required` | All types | Makes the field mandatory |
| `presentable` | All types | Shows in relation picker UI |
| `hidden` | All types | Hides from API responses (admin only) |
| `system` | All types | Marks as system field (cannot be deleted by user) |
