/**
 * sourceSecrets.test.ts — unit tests for the credential mask/restore/strip
 * helper (FIX-04: mask-on-read / restore-on-save).
 */

import { describe, it, expect } from "vitest";
import {
  SECRET_SENTINEL,
  maskPayloadSecrets,
  maskWidgetSecrets,
  restoreWidgetSecrets,
  stripSourcesSecrets,
} from "../src/core/sourceSecrets";
import type { WidgetDoc } from "../src/core/adapters";

function payloadWithSecrets() {
  return {
    misc: {},
    features: {},
    sources: [
      {
        id: "s1",
        method: "GET",
        url: "https://api.example.com/data",
        auth: {
          type: "bearer",
          bearer: "realbearer",
          apiKey: { in: "header", name: "X-API-Key", value: "realapikey" },
          basic: { username: "user", password: "realpassword" },
        },
        headers: {
          Authorization: "Bearer xyz",
          "X-Custom": "keepme",
        },
      },
    ],
    elements: [],
  };
}

describe("maskPayloadSecrets", () => {
  it("masks bearer / apiKey.value / basic.password and sensitive headers", () => {
    const masked = maskPayloadSecrets(payloadWithSecrets()) as ReturnType<typeof payloadWithSecrets>;
    const src = masked.sources[0];
    expect(src.auth.bearer).toBe(SECRET_SENTINEL);
    expect(src.auth.apiKey.value).toBe(SECRET_SENTINEL);
    expect(src.auth.basic.password).toBe(SECRET_SENTINEL);
    expect(src.headers.Authorization).toBe(SECRET_SENTINEL);
  });

  it("leaves non-secret fields intact", () => {
    const masked = maskPayloadSecrets(payloadWithSecrets()) as ReturnType<typeof payloadWithSecrets>;
    const src = masked.sources[0];
    expect(src.url).toBe("https://api.example.com/data");
    expect(src.method).toBe("GET");
    expect(src.auth.type).toBe("bearer");
    expect(src.auth.apiKey.name).toBe("X-API-Key");
    expect(src.auth.basic.username).toBe("user");
    expect(src.headers["X-Custom"]).toBe("keepme");
  });

  it("never mutates the input and never leaks the raw secret", () => {
    const input = payloadWithSecrets();
    const masked = maskPayloadSecrets(input);
    expect(input.sources[0].auth.bearer).toBe("realbearer");
    const json = JSON.stringify(masked);
    expect(json).not.toContain("realbearer");
    expect(json).not.toContain("realapikey");
    expect(json).not.toContain("realpassword");
    expect(json).not.toContain("Bearer xyz");
  });

  it("does not mask empty-string secrets", () => {
    const payload = {
      sources: [{ id: "s1", auth: { type: "bearer", bearer: "" }, headers: { Authorization: "" } }],
    };
    const masked = maskPayloadSecrets(payload) as typeof payload;
    expect(masked.sources[0].auth.bearer).toBe("");
    expect(masked.sources[0].headers.Authorization).toBe("");
  });
});

describe("maskWidgetSecrets", () => {
  it("masks both the primary doc and the fullscreen companion", () => {
    const widget: WidgetDoc = {
      id: "w1",
      name: "W",
      updatedAt: 1,
      doc: payloadWithSecrets(),
      fullscreen: payloadWithSecrets(),
    };
    const masked = maskWidgetSecrets(widget);
    const doc = masked.doc as ReturnType<typeof payloadWithSecrets>;
    const full = masked.fullscreen as ReturnType<typeof payloadWithSecrets>;
    expect(doc.sources[0].auth.bearer).toBe(SECRET_SENTINEL);
    expect(full.sources[0].auth.bearer).toBe(SECRET_SENTINEL);
    // input untouched
    expect((widget.doc as ReturnType<typeof payloadWithSecrets>).sources[0].auth.bearer).toBe("realbearer");
  });

  it("handles a null / absent fullscreen defensively", () => {
    const widget: WidgetDoc = { id: "w1", name: "W", updatedAt: 1, doc: payloadWithSecrets(), fullscreen: null };
    const masked = maskWidgetSecrets(widget);
    expect((masked.doc as ReturnType<typeof payloadWithSecrets>).sources[0].auth.bearer).toBe(SECRET_SENTINEL);
    expect(masked.fullscreen).toBeNull();
  });
});

describe("restoreWidgetSecrets", () => {
  function persisted(): WidgetDoc {
    return {
      id: "w1",
      name: "W",
      updatedAt: 1,
      doc: {
        misc: {}, features: {}, elements: [],
        sources: [{ id: "s1", auth: { type: "bearer", bearer: "realbearer" }, headers: { Authorization: "realauth" } }],
      },
    };
  }

  it("substitutes the persisted secret when incoming === sentinel", () => {
    const p = persisted();
    const incoming: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 2,
      doc: {
        misc: {}, features: {}, elements: [],
        sources: [{ id: "s1", auth: { type: "bearer", bearer: SECRET_SENTINEL }, headers: { Authorization: SECRET_SENTINEL } }],
      },
    };
    restoreWidgetSecrets(incoming, p);
    const src = (incoming.doc as { sources: { auth: { bearer: string }; headers: Record<string, string> }[] }).sources[0];
    expect(src.auth.bearer).toBe("realbearer");
    expect(src.headers.Authorization).toBe("realauth");
  });

  it("keeps a newly entered secret (incoming !== sentinel)", () => {
    const p = persisted();
    const incoming: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 2,
      doc: {
        misc: {}, features: {}, elements: [],
        sources: [{ id: "s1", auth: { type: "bearer", bearer: "newbearer" } }],
      },
    };
    restoreWidgetSecrets(incoming, p);
    const src = (incoming.doc as { sources: { auth: { bearer: string } }[] }).sources[0];
    expect(src.auth.bearer).toBe("newbearer");
  });

  it("deletes the field when incoming === sentinel and no persisted secret exists", () => {
    const p: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 1,
      doc: { misc: {}, features: {}, elements: [], sources: [{ id: "s1", auth: { type: "none" } }] },
    };
    const incoming: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 2,
      doc: {
        misc: {}, features: {}, elements: [],
        sources: [{ id: "s1", auth: { type: "bearer", bearer: SECRET_SENTINEL } }],
      },
    };
    restoreWidgetSecrets(incoming, p);
    const auth = (incoming.doc as { sources: { auth: Record<string, unknown> }[] }).sources[0].auth;
    expect("bearer" in auth).toBe(false);
  });

  it("restores fullscreen-slot secrets too", () => {
    const p: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 1,
      doc: { misc: {}, features: {}, elements: [], sources: [] },
      fullscreen: { misc: {}, features: {}, elements: [], sources: [{ id: "f1", auth: { type: "bearer", bearer: "fsecret" } }] },
    };
    const incoming: WidgetDoc = {
      id: "w1", name: "W", updatedAt: 2,
      doc: { misc: {}, features: {}, elements: [], sources: [] },
      fullscreen: { misc: {}, features: {}, elements: [], sources: [{ id: "f1", auth: { type: "bearer", bearer: SECRET_SENTINEL } }] },
    };
    restoreWidgetSecrets(incoming, p);
    const src = (incoming.fullscreen as { sources: { auth: { bearer: string } }[] }).sources[0];
    expect(src.auth.bearer).toBe("fsecret");
  });
});

describe("stripSourcesSecrets", () => {
  it("removes auth and headers from every source, keeping the rest", () => {
    const sources = [
      { id: "s1", url: "u", method: "GET", auth: { type: "bearer", bearer: "x" }, headers: { Authorization: "y" } },
      { id: "s2", method: "POST" },
    ];
    const stripped = stripSourcesSecrets(sources) as Record<string, unknown>[];
    expect(stripped[0].auth).toBeUndefined();
    expect(stripped[0].headers).toBeUndefined();
    expect(stripped[0].url).toBe("u");
    expect(stripped[0].id).toBe("s1");
    expect(stripped[1]).toEqual({ id: "s2", method: "POST" });
    // input untouched
    expect(sources[0].auth).toBeDefined();
    expect(sources[0].headers).toBeDefined();
  });

  it("passes through a non-array unchanged", () => {
    expect(stripSourcesSecrets(undefined)).toBeUndefined();
  });
});
