# Panel nav regroup — Design

**Date:** 2026-07-26  
**Status:** Approved  
**Approach:** A — simple default nav + Advanced

## Goal

Reduce sidebar clutter from ~17 top-level tabs to a small day-to-day nav, with power tools under a collapsed **Advanced** group. Permissions and page content stay the same; only information architecture changes.

## Sidebar

**Main (always visible):**

| Nav | Opens | In-page sub-tabs |
|-----|--------|------------------|
| Home | `overview` (default) | Overview · Map |
| Players | `players` (default) | Online · Bans · Reports |
| Kits | `kits` | (none) |
| Community | `links` (default) | Links · Automation · Events |
| Server | `stats` | (none) |

**Advanced (collapsed by default):**

RCON (`console`) · Commands · Warps · Analytics · Audit · Keys · Logs

Remember Advanced open/closed in `localStorage` (`advancedNavOpen`).

## Behavior

- Keep `state.tab` as the real content id so existing `render*()` functions stay unchanged.
- Parent nav highlights when any of its child tabs is active.
- Sub-tabs render in `#pageSubtabs` under the page title (not inside each card).
- Hide a parent if the user has permission for none of its children; hide Advanced if none of its items are allowed.
- Legacy aliases: `automsg` / `schedule` → `automation`.
- Deep links by tab id continue to work (land on correct parent + sub-tab).
- Live Map remains “Coming soon” under Home → Map.

## Out of scope

- New features
- Redesigning card interiors beyond grouping
- Changing staff permission keys

## Related UI fixes (same release)

- Desktop sidebar close hides completely (hamburger to reopen)
- Title → content spacing increased (esp. mobile)
