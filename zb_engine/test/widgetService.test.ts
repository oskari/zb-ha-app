/**
 * widgetService.test.ts — Tests for widget ID validation and generation
 *
 * Security-critical: widget IDs are used in filesystem paths.
 * Path traversal attacks must be blocked.
 */

import { describe, it, expect } from "vitest";
import {
  validateWidgetId,
  generateWidgetId,
  readWidget,
  writeWidget,
} from "../src/core/widgetService";
import type { StorageAdapter, Slot, WidgetDoc, WidgetMeta } from "../src/core/adapters";

describe("validateWidgetId", () => {
  it("accepts alphanumeric ID", () => {
    expect(() => validateWidgetId("widget123")).not.toThrow();
  });

  it("accepts ID with underscores and hyphens", () => {
    expect(() => validateWidgetId("my_widget-v2")).not.toThrow();
  });

  it("accepts typical generated ID format", () => {
    expect(() => validateWidgetId("widget_a1b2c3d4_e5f6g7")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateWidgetId("")).toThrow("Invalid widget ID");
  });

  it("rejects path traversal (..)", () => {
    expect(() => validateWidgetId("../etc/passwd")).toThrow("Invalid widget ID");
  });

  it("rejects forward slashes", () => {
    expect(() => validateWidgetId("widget/evil")).toThrow("Invalid widget ID");
  });

  it("rejects backslashes", () => {
    expect(() => validateWidgetId("widget\\evil")).toThrow("Invalid widget ID");
  });

  it("rejects spaces", () => {
    expect(() => validateWidgetId("widget name")).toThrow("Invalid widget ID");
  });

  it("rejects special characters", () => {
    expect(() => validateWidgetId("widget@#$")).toThrow("Invalid widget ID");
  });

  it("rejects null bytes", () => {
    expect(() => validateWidgetId("widget\0evil")).toThrow("Invalid widget ID");
  });

  // §4.8 — Additional path traversal and unicode attack vectors
  it("rejects full path traversal payload (../../etc/passwd)", () => {
    expect(() => validateWidgetId("../../etc/passwd")).toThrow("Invalid widget ID");
  });

  it("rejects relative traversal (../secret)", () => {
    expect(() => validateWidgetId("../secret")).toThrow("Invalid widget ID");
  });

  it("rejects double dots within name (foo..bar)", () => {
    expect(() => validateWidgetId("foo..bar")).toThrow("Invalid widget ID");
  });

  it("rejects Unicode characters (widget™)", () => {
    expect(() => validateWidgetId("widget™")).toThrow("Invalid widget ID");
  });

  it("rejects HTML/script injection in ID (widget<script>)", () => {
    expect(() => validateWidgetId("widget<script>")).toThrow("Invalid widget ID");
  });

  it("rejects emoji in ID", () => {
    expect(() => validateWidgetId("widget🎉")).toThrow("Invalid widget ID");
  });

  it("rejects curly braces", () => {
    expect(() => validateWidgetId("widget{evil}")).toThrow("Invalid widget ID");
  });

  it("rejects percent-encoded traversal (%2e%2e)", () => {
    expect(() => validateWidgetId("%2e%2e%2fetc")).toThrow("Invalid widget ID");
  });
});

describe("generateWidgetId", () => {
  it("returns a string matching the expected format", () => {
    const id = generateWidgetId();
    expect(id).toMatch(/^widget_[a-f0-9]{8}_[a-f0-9]{6}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateWidgetId()));
    expect(ids.size).toBe(100);
  });

  it("generated IDs pass validation", () => {
    for (let i = 0; i < 10; i++) {
      expect(() => validateWidgetId(generateWidgetId())).not.toThrow();
    }
  });
});

// ── Round-trip with the optional fullscreen companion ──────────
//
// Validates the writeWidget/readWidget contract added for the fullscreen companion feature
// Phase 1 — companion presence is preserved end-to-end, the schema
// rejects invalid companions, and "explicit clear" triggers
// `storage.deleteSlot("fullscreen")`.

interface TestStorage extends StorageAdapter {
  _widgets: Map<string, WidgetDoc>;
  _deletedSlots: Slot[];
}

function makeTestStorage(): TestStorage {
  const widgets = new Map<string, WidgetDoc>();
  const deletedSlots: Slot[] = [];
  return {
    _widgets: widgets,
    _deletedSlots: deletedSlots,
    async readWidget(id: string) {
      return widgets.get(id) ?? null;
    },
    async writeWidget(widget: WidgetDoc) {
      widgets.set(widget.id, widget);
    },
    async deleteWidget(id: string) {
      return widgets.delete(id);
    },
    async listWidgets(): Promise<WidgetMeta[]> {
      return Array.from(widgets.values()).map(({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt,
      }));
    },
    async readPayload() { return null; },
    async writePayload() { return false; },
    async writeCachedImage() { return false; },
    getCachedImagePath() { return null; },
    async deleteSlot(slot: Slot) {
      deletedSlots.push(slot);
    },
  };
}

const validFullscreen = {
  misc: { size: { width: 800, height: 480 }, gridSize: "3x2" },
  features: {},
  sources: [],
  elements: [],
};

const validPrimary = {
  misc: { size: { width: 240, height: 240 }, gridSize: "1x1" },
  features: {},
  sources: [],
  elements: [],
};

describe("widget round-trip with fullscreen companion", () => {
  it("persists and reads back a widget without a companion", async () => {
    const storage = makeTestStorage();
    const widget: WidgetDoc = {
      id: "widget_aa11bb22_cc33dd",
      name: "test",
      doc: validPrimary,
      updatedAt: 1,
    };

    await writeWidget(storage, widget);
    const read = await readWidget(storage, widget.id);

    expect(read).not.toBeNull();
    expect(read?.fullscreen).toBeUndefined();
    expect(storage._deletedSlots).toEqual([]);
  });

  it("rejects a widget whose primary doc is not a valid payload", async () => {
    const storage = makeTestStorage();
    const widget: WidgetDoc = {
      id: "widget_aa11bb22_cc33dd",
      name: "test",
      doc: { misc: {}, features: {}, sources: [], elements: [] },
      updatedAt: 1,
    };

    await expect(writeWidget(storage, widget)).rejects.toThrow(/Invalid widget payload/);
    expect(storage._widgets.size).toBe(0);
  });

  it("persists a widget WITH a valid companion payload", async () => {
    const storage = makeTestStorage();
    const widget: WidgetDoc = {
      id: "widget_aa11bb22_cc33dd",
      name: "test",
      doc: validPrimary,
      fullscreen: validFullscreen,
      updatedAt: 1,
    };

    await writeWidget(storage, widget);
    const read = await readWidget(storage, widget.id);

    expect(read?.fullscreen).toBeDefined();
    expect(read?.fullscreen).toMatchObject({
      misc: { gridSize: "3x2", size: { width: 800, height: 480 } },
    });
  });

  it("rejects a widget whose companion is not 3x2", async () => {
    const storage = makeTestStorage();
    const bad: WidgetDoc = {
      id: "widget_aa11bb22_cc33dd",
      name: "test",
      doc: validPrimary,
      fullscreen: { ...validFullscreen, misc: { ...validFullscreen.misc, gridSize: "1x1" } },
      updatedAt: 1,
    };

    await expect(writeWidget(storage, bad)).rejects.toThrow(/Invalid fullscreen payload/);
    expect(storage._widgets.size).toBe(0); // never persisted
  });

  it("calls deleteSlot('fullscreen') when companion is explicitly cleared", async () => {
    const storage = makeTestStorage();
    const id = "widget_aa11bb22_cc33dd";

    // Seed the widget WITH a companion.
    await writeWidget(storage, {
      id,
      name: "test",
      doc: validPrimary,
      fullscreen: validFullscreen,
      updatedAt: 1,
    });

    // Now write again with fullscreen explicitly null.
    await writeWidget(storage, {
      id,
      name: "test",
      doc: validPrimary,
      fullscreen: null,
      updatedAt: 2,
    });

    expect(storage._deletedSlots).toEqual(["fullscreen"]);
  });

  it("does NOT call deleteSlot when companion was never present (explicit-clear is idempotent)", async () => {
    const storage = makeTestStorage();
    const id = "widget_aa11bb22_cc33dd";

    // Seed the widget WITHOUT a companion.
    await writeWidget(storage, { id, name: "test", doc: validPrimary, updatedAt: 1 });

    // Write again with fullscreen explicitly null — nothing to delete.
    await writeWidget(storage, {
      id,
      name: "test",
      doc: validPrimary,
      fullscreen: null,
      updatedAt: 2,
    });

    expect(storage._deletedSlots).toEqual([]);
  });

  it("does NOT call deleteSlot when fullscreen key is omitted entirely", async () => {
    const storage = makeTestStorage();
    const id = "widget_aa11bb22_cc33dd";

    await writeWidget(storage, {
      id,
      name: "test",
      doc: validPrimary,
      fullscreen: validFullscreen,
      updatedAt: 1,
    });

    // Subsequent write omits the key — that is NOT an explicit clear.
    await writeWidget(storage, { id, name: "test", doc: validPrimary, updatedAt: 2 });

    expect(storage._deletedSlots).toEqual([]);
  });
});
