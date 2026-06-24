#!/bin/sh
# Runtime entrypoint: fix /data ownership then drop to non-root.
#
# HA Supervisor mounts /data as a root-owned volume at runtime, overriding
# the chown done during docker build. This script runs as root on container
# start, fixes permissions, then drops to the unprivileged 'app' user via
# su-exec (no PID overhead — replaces the current process).

set -e

# Ensure the widgets directory exists and is writable by the app user.
mkdir -p /data/widgets
chown -R app:app /data

# Drop privileges and exec the Node server (PID 1 = Node, not this shell).
exec su-exec app node dist/ha/index.js
