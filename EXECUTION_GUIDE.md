# Loving Speech Around the World — Execution Guide

## Goals

- Provide a Tor-friendly, love-letter themed distributed storage app with three node modes: Directory, Relay+Client.
- Expose both WebUI (Express + lightweight frontend) and CLI flows for every capability.
- Keep implementations modular (per-mode subdirectories and pluggable JS services).
- Deliver complete runnable assets (code, docs, scripts, tests) without placeholders.

## Architecture Outline

| Layer | Responsibilities |
| --- | --- |
| Core Libraries (`src/lib`) | Shared crypto utilities, block store, Tor control, message bus. |
| Modes (`modes/directory`, `modes/relay`, `modes/client`) | Mode-specific services, HTTP + CLI entry points, Tor integration wrappers. |
| UI (`web/…`) | React-free minimal view layer using vanilla JS + HTMX-style partials for simplicity. |
| CLI (`cli/…`) | Commander-based multi-command interface mirroring WebUI features. |

## Major Features

1. **Directory Mode**
   - Maintains authoritative list of Relay onion endpoints, freshness metadata, and block hash manifests.
   - Push notifications / polling API for Relays and Clients.
   - Web dashboard for Tor connection settings and relay health.
2. **Relay Mode**
   - Receives encrypted love-letter blocks, validates chain, reports health metrics.
   - Periodically uploads block checksums to Directory, syncs missing segments from peers.
3. **Client Mode**
   - Local key management (generation/import), compose encrypted letters, upload to preferred Relay.
   - Syncs blocks from optimal Relay and searches for user-owned letters.
4. **Shared Tor Control**
   - Dynamic torrc generation, progress logging, bridge configuration, startup lifecycle watchers.
   - Both WebUI + CLI forms for configuring and watching connection state.

## Implementation Sequence

1. Bootstrap Node workspace, lint/tests, shared configs.
2. Implement shared libraries (crypto, storage, tor launcher, networking adapters).
3. Build Directory service (REST + WebUI + CLI). Add block metadata persistence.
4. Build Relay service (chain mgmt, metrics reporting, Tor binding).
5. Build Client service (key mgmt, block composer, search UI/CLI).
6. Wire synchronization logic + intelligent relay selection heuristic.
7. Provide scripts, README, sample data, and validation tests.

## Testing Strategy

- Unit tests for crypto, block validation, tor config builder, relay selection.
- Integration-style tests using supertest to hit REST endpoints per mode.
- CLI smoke tests invoking main commands with mocked Tor launcher.

## Deliverables Checklist

- `package.json`, `tsconfig.json` (if TS) or JS equivalent, lint config.
- Source tree with modular structure, including pluggable adapters.
- Public assets for three WebUIs with Tor configuration panes.
- CLI entry points replicating UI behaviors.
- Comprehensive README plus quickstart commands.
- Automated tests and demonstration data.
