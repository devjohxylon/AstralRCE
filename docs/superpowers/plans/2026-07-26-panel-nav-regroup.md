# Panel nav regroup — Implementation Plan

> **For agentic workers:** Implement in `src/server/admin/panel.html` only (plus this/spec docs). No backend changes.

**Goal:** Approach A sidebar + page sub-tabs per approved design.

**Files:**
- Modify: `src/server/admin/panel.html`
- Docs: `docs/superpowers/specs/2026-07-26-panel-nav-regroup-design.md`

## Task 1: Nav config + HTML

Add `NAV_SECTIONS` / `ADVANCED_TABS` / `TAB_META` in script. Replace sidebar button list with Home/Players/Kits/Community/Server + Advanced toggle + advanced children.

## Task 2: setTab / permissions / subtabs

Update `applyNavPermissions`, `setTab`, click handlers for `data-nav` parents and `data-tab` leaves. Render `#pageSubtabs`. Persist Advanced expand state.

## Task 3: Smoke check

Verify: parent highlight, sub-tab switch, Advanced collapse, permission hiding, existing renders still work.
