# Nuvriqo Shift & Assignment Manager

Early Forge application foundation for shift-aware Jira Service Management assignment.

## Current foundation

- Time-zone aware recurring shift eligibility
- Overnight shifts
- Temporary include/exclude overrides
- Deterministic rule matching and priority ordering
- Round-robin, least-loaded, fixed-order and random assignment selectors
- Owner-continuity protection
- Non-destructive handling when nobody is eligible
- Node test suite

## V1 direction

The app will maintain shift schedules and assignment rules, then use them to automatically route Jira Service Management work to eligible agents who are currently on shift. V1 includes shift-aware assignment, handover, SLA-aware routing, simulation/decision tracing and audit history.

## Next implementation step

Add the Forge app identity, Jira admin Custom UI shell, KVS repositories, resolver layer and event/scheduled-trigger adapters.
