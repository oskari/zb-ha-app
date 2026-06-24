# Security Policy

## Supported versions

ZerryBit Engine is shipped as a Home Assistant add-on. Security fixes are
applied to the latest released version only. Please reproduce any issue on the
current release before reporting.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
GitHub issue for a suspected vulnerability.

- **Email (primary):** `contact@zerrybit.com`.
- **GitHub private vulnerability reporting:** use "Report a vulnerability" under
  the repository's **Security** tab (see GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Please include enough detail to reproduce: affected version, configuration, a
proof-of-concept or steps, and the impact you observed.

**Response targets:** we aim to acknowledge a report within **5 business days**
and to provide an initial assessment within **10 business days**. Coordinated
disclosure is appreciated — please give us a reasonable window to ship a fix
before any public disclosure.

## Scope and trust model

This add-on is designed to run on a **trusted Home Assistant host on a trusted
LAN**. Some behaviors are intentional given that model and are documented rather
than treated as vulnerabilities — see the README
"[Security & data handling](README.md#security--data-handling)" section. In
particular:

- **Port 8000 (ESP32 endpoint) is unauthenticated by design.** It must stay on a
  trusted LAN and must not be port-forwarded or exposed to the internet.
- **Source credentials are stored at rest in plaintext** under `/data` so the
  add-on can replay the fetch at render time. They are masked on the read API
  but not encrypted on disk; the HA host is the trust boundary.
- **Outbound fetches can reach any public host out of the box.** Private and
  reserved IP ranges are always blocked (SSRF protection with redirect
  re-validation), and an optional `allowed_source_domains` allowlist can
  restrict egress to specific hosts. A residual DNS-rebinding window exists
  between validation and the actual fetch.

Reports that rely on having root/volume access to the HA host, or on exposing
the unauthenticated ESP32 port to an untrusted network, fall outside this trust
model. Reports of issues exploitable **within** the documented model (e.g. a
panel user reading another user's stored credentials, an SSRF bypass reaching a
private host, a sanitizer bypass, or a remote crash/DoS) are in scope and
welcome.
