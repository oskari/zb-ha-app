# Agent widget examples

Sample JSON files for testing **Import widget** in the Widget Builder.

| File | Format | Notes |
|------|--------|-------|
| [`envelope-minimal.json`](envelope-minimal.json) | Import envelope v1 | Static layout, no HA sources |
| [`envelope-ha-temperature.json`](envelope-ha-temperature.json) | Import envelope v1 | Replace `sensor.living_room_temperature` with a real entity on your HA instance |
| [`bare-runtime-minimal.json`](bare-runtime-minimal.json) | Bare runtime payload | Also accepted by import |
| [`zerrybit-widget-karpalo.json`](zerrybit-widget-karpalo.json) | Import envelope v1 | 720×480 outdoor weather + `haCalendar` / `calendarList` for `calendar.family` |

Authoring reference: [`../../AGENT_WIDGET_AUTHORING.md`](../../AGENT_WIDGET_AUTHORING.md).
