# Agent guide — authoring importable ZerryBit widgets

**Audience:** AI coding agents, automation scripts, and humans generating widget JSON offline.

**Goal:** Produce a `.json` file the Widget Builder can **Import widget** (welcome screen or top-bar dropdown). Import always creates a **new** widget on the server.

**Canonical validation:** Server Zod schemas in [`src/schema/`](src/schema/) (`payloadSchema.ts`, `elementSchema.ts`, `sourceSchema.ts`). This guide is a practical subset.

---

## 1. Accepted file shapes

### A. Import envelope (recommended for full widgets)

Matches Top-bar **Export** output (`exportVersion: 1`):

```json
{
  "exportVersion": 1,
  "exportedAt": 1739123456789,
  "name": "Living room temperature",
  "doc": { "misc": {}, "features": {}, "sources": [], "elements": [] },
  "fullscreen": null
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `exportVersion` | Yes | Must be `1` |
| `exportedAt` | No | Unix ms; informational |
| `name` | No | Widget display name; falls back to `doc.misc.name` or `Untitled N` |
| `doc` | Yes | Primary slot **runtime payload** (see §2) |
| `fullscreen` | No | Companion slot payload or `null`. If set, `doc.misc.gridSize` on companion must be `"3x2"` |

### B. Bare runtime payload (primary slot only)

Also accepted by import — same shape as deploy/render payload:

```json
{
  "misc": { "size": { "width": 480, "height": 320 }, "format": "png" },
  "features": {},
  "sources": [],
  "elements": []
}
```

---

## 2. Runtime payload structure

Every `doc` / `fullscreen` / bare file MUST be:

```json
{
  "misc": { "size": { "width": <number>, "height": <number> }, ... },
  "features": { "<key>": "<string|number|boolean>", ... },
  "sources": [ ... ],
  "elements": [ ... ]
}
```

### `misc` (required)

```json
{
  "misc": {
    "size": { "width": 480, "height": 320 },
    "format": "png",
    "name": "Optional label",
    "gridSize": "2x1",
    "type": "",
    "subcategory": "",
    "tags": []
  }
}
```

| Field | Rules |
|-------|--------|
| `size.width`, `size.height` | Required, positive, max **4096** each |
| `format` | `"png"` (default) or `"bin"` |
| `gridSize` | `"1x1"`, `"1x2"`, `"2x1"`, `"2x2"`, `"3x2"`. Full screen = `"3x2"`. Companion `fullscreen` slot **must** use `"3x2"` |
| `name` | Optional; used as widget name if envelope `name` is empty |

**Canvas sizing tip:** On a **800×480** reference display, grid cells scale from a 3×2 reference grid. Example pixel sizes:

| `gridSize` | Approx. size (800×480 screen) |
|------------|-------------------------------|
| `1x1` | 267 × 240 |
| `2x1` | 533 × 240 |
| `1x2` | 267 × 480 |
| `2x2` | 533 × 480 |
| `3x2` | 800 × 480 |

You may set `misc.size` explicitly to match the target device; it does not have to match `gridSize` math if you know exact pixel dimensions (e.g. `296×128` e-ink module).

### `features` (optional)

Flat key-value map resolved **before** sources. Use for static labels or user constants:

```json
"features": { "city": "Helsinki", "showGraph": true }
```

Bindings: `{{features.city}}` or `{ "$": "features.city" }`.

Do **not** use editor-only `{ "definitions": { ... } }` — that is builder-internal. Agents emit the **runtime** flat object.

### `sources` (optional, max 50)

Unique `id` per source; must start with a letter (`^[a-zA-Z][a-zA-Z0-9_-]*$`, max 64 chars). Reserved: `misc`, `features`, `__proto__`, `constructor`, `prototype`.

#### `haState` — live entity snapshot

```json
{
  "id": "temp",
  "kind": "haState",
  "entity_id": "sensor.living_room_temperature",
  "enabled": true
}
```

Bindings: `{{temp.state}}`, `{{temp.value}}`, `{{temp.attributes.unit_of_measurement}}`.

#### `haHistory` — time series (graphs)

```json
{
  "id": "temp_hist",
  "kind": "haHistory",
  "entity_id": "sensor.living_room_temperature",
  "hoursBack": 24
}
```

Bindings: `{{temp_hist.latest}}`, `{{temp_hist.min}}`, `{{temp_hist.max}}`, `{{temp_hist.avg}}`. Graph `sourceId` uses `points` array.

#### `haCalendar` — upcoming events

```json
{
  "id": "family_cal",
  "kind": "haCalendar",
  "entity_id": "calendar.family",
  "daysAhead": 14,
  "maxEvents": 5,
  "locale": "en"
}
```

Use with a `calendarList` element (see §3).

#### `http` — public HTTP API

```json
{
  "id": "weather",
  "kind": "http",
  "method": "GET",
  "url": "https://api.open-meteo.com/v1/forecast?latitude=60.17&longitude=24.94&current_weather=true",
  "response": { "type": "json" },
  "timeoutMs": 5000,
  "dataFields": [
    { "id": "temp", "name": "Temp", "path": "current_weather.temperature", "type": "number", "defaultValue": 0 }
  ]
}
```

URLs must be **public** (no LAN/private IPs). SSRF rules apply at render time.

### `elements` (required array)

Draw order: index `0` = bottom layer. Max **2000** top-level, **10000** total including nested `group.children`, max nesting depth **32**.

#### Common element types

| `type` | Purpose | Key fields |
|--------|---------|------------|
| `rect` | Box | `pos`, `sizeX`, `sizeY`, `enableFill`, `fill` (0–100 dither), `enableStroke`, `strokeWidth`, `strokeRadius` |
| `circle` | Ellipse | `pos` = **center** (runtime), `sizeX`, `sizeY` diameter axes |
| `line` | Polyline | `pos`, `points`: `[[x,y], ...]` relative to `pos`, stroke fields |
| `text` | Bitmap text | `text`, `fontFamily` (`"Sora"`), `fontSize`, `fontWeight` (300/400/600), `textAlign`, `enableFill`, `fill` |
| `img` | Raster image | `src` URL or `asset:<uuid>.png` (assets not embedded in import files) |
| `svg` | Inline/URL SVG | `svg` inline string and/or `src` |
| `graph` | Line/bar chart | `sourceId`, `chartType` (`"line"`/`"bar"`), `dataPath`, `valuePath`, `timePath` |
| `calendarList` | Event list | `sourceId` → `haCalendar`, `maxLines`, `lineHeight`, `fontSize` |
| `group` | Container | `children`: nested elements |

Shared on most types: `visible` (default `true`), `opacity` (0–100), `rotationDeg`, `scale`, `origin`, optional `id`, `name`.

#### Minimal static widget

```json
{
  "misc": { "size": { "width": 296, "height": 128 }, "format": "png", "name": "Hello", "gridSize": "1x1" },
  "features": {},
  "sources": [],
  "elements": [
    {
      "type": "rect",
      "pos": { "x": 0, "y": 0 }, "sizeX": 296, "sizeY": 128,
      "enableFill": true, "fill": 0
    },
    {
      "type": "text",
      "pos": { "x": 12, "y": 48 }, "sizeX": 272, "sizeY": 32,
      "text": "Hello, e-ink!",
      "fontFamily": "Sora", "fontSize": 20, "fontWeight": 600,
      "enableFill": true, "fill": 100
    }
  ]
}
```

#### HA temperature label (dynamic)

```json
{
  "misc": { "size": { "width": 400, "height": 240 }, "format": "png", "gridSize": "2x1" },
  "features": {},
  "sources": [
    { "id": "temp", "kind": "haState", "entity_id": "sensor.living_room_temperature" }
  ],
  "elements": [
    { "type": "rect", "pos": { "x": 0, "y": 0 }, "sizeX": 400, "sizeY": 240, "enableFill": true, "fill": 0 },
    {
      "type": "text",
      "pos": { "x": 16, "y": 80 }, "sizeX": 368, "sizeY": 80,
      "text": "{{temp.state}} °C",
      "fontFamily": "Sora", "fontSize": 34, "fontWeight": 600,
      "enableFill": true, "fill": 100
    }
  ]
}
```

---

## 3. Bindings (dynamic field values)

| Form | Example |
|------|---------|
| String interpolation | `"{{temp.state}} °C"` |
| Binding object | `{ "$": "temp.latest" }` |
| With default | `{ "$": "temp.latest", "default": "—" }` |
| Conditional | `{ "if": [{ "==": [{ "$": "temp.value" }, null] }, "N/A", { "$": "temp.state" }] }` |

Context roots: `misc.*`, `features.*`, `<sourceId>.*`.

**Limits:** `line.points` is a static array — cannot bind per-point coordinates. Use `graph` for series data, or bake coordinates at build time.

---

## 4. Limits checklist

| Limit | Value |
|-------|-------|
| Request body | 2 MB |
| Sources | 50 |
| Top-level elements | 2000 |
| Total elements (nested) | 10000 |
| Nesting depth (`group`) | 32 |
| Canvas dimension | 4096 px |
| Feature keys | 1000 |
| Source `hoursBack` | 1–168 |

---

## 5. Assets and secrets

- **`asset:<filename>`** image references are **not** included in export files. Import on another HA instance warns if assets are missing; user must re-upload via builder asset picker.
- **HTTP source credentials** in exported files are stored in clear text. Treat generated files as sensitive.

---

## 6. Agent workflow

1. Choose canvas `misc.size` (and optional `gridSize`) for the target display.
2. Add `sources` for live data (prefer `haState` / `haHistory` on HA).
3. Build `elements` bottom-to-top; use `{{…}}` bindings in text and bindable fields.
4. Wrap in **envelope v1** (§1A) with a human-readable `name`.
5. Write `zerrybit-widget-<name>.json`.
6. User imports via Builder → **Import widget** (creates new widget). **Deploy** is still required to push to the ESP32 image endpoint.

### Validation before handoff

- [ ] Valid JSON, single root object
- [ ] `misc.size.width` and `misc.size.height` > 0
- [ ] `elements` and `sources` are arrays
- [ ] Every source `id` unique, starts with letter
- [ ] Every `entity_id` matches `domain.object_id` (lowercase)
- [ ] `graph.sourceId` / `calendarList.sourceId` reference an existing source
- [ ] If `fullscreen` is set, its `misc.gridSize` is `"3x2"`
- [ ] No `asset:` refs unless user will upload those files on the target system

---

## 7. Example files

Ready-to-import samples in [`examples/agent-widgets/`](examples/agent-widgets/):

| File | Description |
|------|-------------|
| `envelope-minimal.json` | Envelope v1, static hello widget |
| `envelope-ha-temperature.json` | Envelope v1, `haState` + bound text |
| `zerrybit-widget-karpalo.json` | Envelope v1, outdoor weather + `haCalendar` + `calendarList` (720×480) |
| `bare-runtime-minimal.json` | Bare payload (import also accepts this) |

---

## 8. Further reference

| Topic | Location |
|-------|----------|
| Import/export UI behaviour | [`BUILDER_API.md`](BUILDER_API.md) § Widget file import / export |
| Full payload & binding reference | [`BUILDER_API.md`](BUILDER_API.md) §4–5 |
| Product-oriented examples | [`README.md`](../README.md) |
| Editor ↔ runtime mapping | [`builder/src/models/mapper.js`](builder/src/models/mapper.js) |
| Demo payload | [`payload.json`](payload.json) |
