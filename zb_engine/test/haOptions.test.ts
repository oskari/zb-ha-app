/**
 * haOptions.test.ts — Tests for options.json Zod validation
 *
 * Verifies that malformed HA add-on config is rejected at load time.
 * Uses filesystem mocking to test without real /data/options.json.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// Mock fs before importing the module
vi.mock("fs");

// Import after mocking
import { loadOptions } from "../src/ha/haOptions";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadOptions", () => {
  it("returns defaults when file does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const opts = loadOptions();
    expect(opts).toEqual({
      allowed_source_domains: [],
      re_render_minutes: 0,
      image_port_cooldown_ms: 4000,
      image_port_mode: "on-demand",
    });
  });

  it("parses valid options", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        allowed_source_domains: ["api.weather.com"],
        re_render_minutes: 10,
      }),
    );
    const opts = loadOptions();
    expect(opts.allowed_source_domains).toEqual(["api.weather.com"]);
    expect(opts.re_render_minutes).toBe(10);
  });

  it("applies defaults for missing fields", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({}));
    const opts = loadOptions();
    expect(opts.allowed_source_domains).toEqual([]);
    expect(opts.re_render_minutes).toBe(0); // schema default (scheduler disabled)
  });

  it("rejects re_render_minutes over 60", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ re_render_minutes: 999 }),
    );
    const opts = loadOptions();
    // Should fall back to defaults because validation fails
    expect(opts.re_render_minutes).toBe(0); // DEFAULTS value
  });

  it("rejects re_render_minutes as string", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ re_render_minutes: "five" }),
    );
    const opts = loadOptions();
    expect(opts.re_render_minutes).toBe(0); // falls back to DEFAULTS
  });

  it("rejects allowed_source_domains as string instead of array", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ allowed_source_domains: "*" }),
    );
    const opts = loadOptions();
    expect(opts.allowed_source_domains).toEqual([]); // falls back to DEFAULTS
  });

  it("rejects more than 50 allowed domains", () => {
    mockedFs.existsSync.mockReturnValue(true);
    const domains = Array.from({ length: 51 }, (_, i) => `domain${i}.com`);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ allowed_source_domains: domains }),
    );
    const opts = loadOptions();
    expect(opts.allowed_source_domains).toEqual([]); // falls back to DEFAULTS
  });

  it("returns defaults on malformed JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not-json{{{");
    const opts = loadOptions();
    expect(opts).toEqual({
      allowed_source_domains: [],
      re_render_minutes: 0,
      image_port_cooldown_ms: 4000,
      image_port_mode: "on-demand",
    });
  });

  it("passes through extra HA keys without error", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        allowed_source_domains: [],
        re_render_minutes: 3,
        some_future_ha_field: true,
      }),
    );
    const opts = loadOptions();
    expect(opts.re_render_minutes).toBe(3);
  });
});
