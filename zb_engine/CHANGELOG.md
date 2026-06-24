# Changelog

All notable changes to ZerryBit Engine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

Initial public release of ZerryBit Engine — a self-contained, fully local Home
Assistant add-on that renders 1-bit (e-ink) images from a declarative JSON
payload, with a built-in visual widget builder. No cloud dependency.

### Added

- **1-bit rendering engine.** A 7-phase render pipeline (Parse → Features →
  Sources → Context → Bindings → Draw → Encode) that outputs both a packed
  1-bit binary (`GET /image.bin`) for direct ESP32 consumption and a PNG
  (`GET /image.png`) for preview, with per-element error isolation and a global
  render timeout.
- **Drawing primitives.** Rectangle, circle/arc/ring, polyline, bitmap text,
  raster image, inline/fetched SVG, and recursive groups — with affine
  transforms (rotation, scale, pivot) and Bayer ordered dithering.
- **Bitmap font system.** Pre-rasterized Sora font set with nearest-variant
  size/weight snapping and family fallback.
- **Declarative data pipeline.** Parallel HTTP source fetching (JSON/XML/CSV/
  text), Home Assistant entity-state and history sources via the Supervisor
  API, dot-path field extraction, and a sandboxed binding/expression engine
  (`@zb/expressions`) shared by the server renderer and the builder preview.
- **Visual widget builder.** A local single-page builder served over Home
  Assistant Ingress for composing widgets, previewing server-rendered output,
  and saving or deploying payloads.
- **Dual-port architecture.** Port 8099 (HA Ingress, session-authenticated) for
  the builder and management APIs; port 8000 (unauthenticated, read-only) for
  ESP32 image polling. Renders are written with hash-before-write to protect
  SD cards.

### Security

- **SSRF protection.** All user-supplied URLs are validated against private and
  reserved IP ranges (including alternate IPv4/IPv6 encodings), with an optional
  domain allowlist and re-validation of redirect targets.
- **SVG sanitization.** Fetched and inline SVG is sanitized through an
  allowlist XML parser before rasterization; raw asset responses carry a
  locked-down `Content-Security-Policy`, `nosniff`, and force-download.
- **Input validation & quotas.** Zod schema validation at every API boundary,
  widget ID sanitization, request size limits, an expression evaluation budget,
  and per-host storage/asset quotas sized for a Raspberry Pi.
- **Container hardening.** The add-on drops Linux capabilities and ships an
  AppArmor profile.
- **Credential handling.** Source authentication secrets are masked on the read
  APIs and redacted from container logs.

### Known limitations

- **Open egress by default.** With an empty `allowed_source_domains`, the add-on
  can fetch any public host (private/reserved ranges are always blocked). Set
  the allowlist to restrict egress. See [SECURITY.md](../SECURITY.md).
- **DNS-rebinding TOCTOU.** A residual window remains between URL validation and
  fetch; documented and accepted for the local HA add-on.
- **In-memory rate limits.** Rate limits reset on add-on/container restart.
