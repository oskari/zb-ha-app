/**
 * hostIpSelect.test.ts — host LAN IP selection from Supervisor /network/info
 *
 * Covers the pure interface-selection logic behind GET /api/host-ip: primary
 * preference, CIDR stripping, and the exclusion of loopback / link-local
 * addresses and Docker / VPN interfaces. Selection is the part with real logic
 * (and where field bugs hide), so it is tested directly without a Supervisor.
 */

import { describe, it, expect } from "vitest";
import { selectHostIp, selectAddonImagePort, type SupervisorInterface } from "../src/ha/haNetwork";

/** Minimal interface builder — only the fields selectHostIp reads. */
function iface(partial: Partial<SupervisorInterface>): SupervisorInterface {
  return {
    enabled: true,
    connected: true,
    primary: false,
    ipv4: { address: [], ready: true },
    ...partial,
  };
}

describe("selectHostIp", () => {
  it("returns null with no candidates for empty / undefined input", () => {
    expect(selectHostIp([])).toEqual({ ip: null, candidates: [] });
    expect(selectHostIp(undefined)).toEqual({ ip: null, candidates: [] });
  });

  it("extracts the IPv4 and strips the CIDR suffix", () => {
    const result = selectHostIp([
      iface({ interface: "eth0", primary: true, ipv4: { address: ["192.168.1.50/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.50");
    expect(result.candidates).toEqual([
      { interface: "eth0", ip: "192.168.1.50", primary: true },
    ]);
  });

  it("prefers the primary interface over a non-primary one regardless of order", () => {
    const result = selectHostIp([
      iface({ interface: "wlan0", primary: false, ipv4: { address: ["192.168.1.77/24"] } }),
      iface({ interface: "eth0", primary: true, ipv4: { address: ["192.168.1.50/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.50");
    // Both are valid candidates; the primary is listed first.
    expect(result.candidates.map((c) => c.ip)).toEqual(["192.168.1.50", "192.168.1.77"]);
  });

  it("keeps Supervisor order among non-primary interfaces (stable sort)", () => {
    const result = selectHostIp([
      iface({ interface: "eth0", ipv4: { address: ["192.168.1.10/24"] } }),
      iface({ interface: "eth1", ipv4: { address: ["192.168.1.20/24"] } }),
    ]);
    expect(result.candidates.map((c) => c.ip)).toEqual(["192.168.1.10", "192.168.1.20"]);
    expect(result.ip).toBe("192.168.1.10");
  });

  it("excludes loopback and link-local addresses", () => {
    const result = selectHostIp([
      iface({ interface: "lo", ipv4: { address: ["127.0.0.1/8"] } }),
      iface({ interface: "eth0", ipv4: { address: ["169.254.10.10/16"] } }),
    ]);
    expect(result).toEqual({ ip: null, candidates: [] });
  });

  it("excludes Docker, veth, and VPN/tunnel interfaces", () => {
    const result = selectHostIp([
      iface({ interface: "docker0", ipv4: { address: ["172.30.32.1/23"] } }),
      iface({ interface: "veth123", ipv4: { address: ["172.30.33.5/23"] } }),
      iface({ interface: "wg0", ipv4: { address: ["10.6.0.1/24"] } }),
      iface({ interface: "tailscale0", ipv4: { address: ["100.64.0.1/32"] } }),
      iface({ interface: "eth0", primary: true, ipv4: { address: ["192.168.1.50/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.50");
    expect(result.candidates).toHaveLength(1);
  });

  it("does not exclude wlan0 (the 'wg' prefix must not match Wi-Fi)", () => {
    const result = selectHostIp([
      iface({ interface: "wlan0", primary: true, ipv4: { address: ["192.168.1.99/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.99");
  });

  it("skips disabled or disconnected interfaces", () => {
    const result = selectHostIp([
      iface({ interface: "eth0", connected: false, ipv4: { address: ["192.168.1.50/24"] } }),
      iface({ interface: "eth1", enabled: false, ipv4: { address: ["192.168.1.60/24"] } }),
      iface({ interface: "wlan0", ipv4: { address: ["192.168.1.70/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.70");
    expect(result.candidates).toHaveLength(1);
  });

  it("uses the first usable address when an interface has several", () => {
    const result = selectHostIp([
      iface({ interface: "eth0", ipv4: { address: ["192.168.1.50/24", "10.0.0.5/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.50");
  });

  it("tolerates a missing / null ipv4 block without throwing", () => {
    const result = selectHostIp([
      iface({ interface: "eth0", ipv4: null }),
      iface({ interface: "eth1", ipv4: { address: undefined } }),
      iface({ interface: "wlan0", primary: true, ipv4: { address: ["192.168.1.50/24"] } }),
    ]);
    expect(result.ip).toBe("192.168.1.50");
  });
});

describe("selectAddonImagePort", () => {
  it("returns the host port the image container port (8000/tcp) is mapped to", () => {
    expect(selectAddonImagePort({ "8000/tcp": 8123 })).toBe(8123);
  });

  it("returns the default-mapped port unchanged", () => {
    expect(selectAddonImagePort({ "8000/tcp": 8000 })).toBe(8000);
  });

  it("returns null when the image port is unmapped (null)", () => {
    expect(selectAddonImagePort({ "8000/tcp": null })).toBeNull();
  });

  it("returns null when the image port key is absent", () => {
    expect(selectAddonImagePort({ "9000/tcp": 9000 })).toBeNull();
  });

  it("returns null for a missing / empty network map", () => {
    expect(selectAddonImagePort(undefined)).toBeNull();
    expect(selectAddonImagePort({})).toBeNull();
  });

  it("rejects out-of-range or non-integer ports", () => {
    expect(selectAddonImagePort({ "8000/tcp": 0 })).toBeNull();
    expect(selectAddonImagePort({ "8000/tcp": -1 })).toBeNull();
    expect(selectAddonImagePort({ "8000/tcp": 70000 })).toBeNull();
    expect(selectAddonImagePort({ "8000/tcp": 3.5 })).toBeNull();
  });
});
