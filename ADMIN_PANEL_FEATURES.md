# Admin Panel Advanced Features

## Overview

The Astral Bot admin panel has been upgraded with real-time WebSocket updates, advanced analytics, live map visualization, and comprehensive player profile management.

## New Features

### 1. Real-Time WebSocket Updates ✅

**What it does:**
- Live server status updates every 3 seconds
- Real-time player join/leave notifications
- Instant kill event broadcasts
- Live player position updates for map
- No more page refreshing needed

**Technical Implementation:**
- Socket.IO server at `/admin/socket.io`
- Authenticated connections using session cookies
- Broadcasts: `server:update`, `players:update`, `kill:new`, `player:join`, `player:leave`, `alert:new`
- Auto-reconnection on disconnect

**Files:**
- `src/server/websocket.js` - WebSocket server
- `src/bot.js` - Integration with bot lifecycle
- `src/modules/rcon/feeds.js` - Broadcasting integration

---

### 2. Analytics Dashboard ✅

**What it shows:**
- Peak and average player counts (24 hours)
- Average server FPS
- Active player count (unique players last 30 days)
- Player activity chart (hourly peaks over 24h)
- Top 10 weapons by kills
- Server performance chart (FPS over last hour)

**Technical Implementation:**
- Historical data tracking in `.data/analytics.json`
- Hourly player count sampling
- Weapon kill statistics
- Server performance metrics (FPS, entities, players)
- Chart.js for visualizations
- Data retention: 7 days for hourly, 30 days for daily

**Files:**
- `src/modules/analytics/tracker.js` - Data collection
- `src/data/store.js` - Persistence layer
- Admin panel HTML - Chart rendering with Chart.js

**API Endpoints:**
- `GET /admin/api/analytics` - Fetch analytics summary

---

### 3. Live Map Visualization ✅

**What it shows:**
- Real-time player positions on 2D grid
- Player IGN labels
- Coordinate display in table
- Click-to-view player profile

**Technical Implementation:**
- Canvas-based map rendering
- 4000x4000 map size assumption (configurable)
- Grid overlay for reference
- Updates via WebSocket `players:update` event
- Position data from RCON client

**Files:**
- Admin panel HTML - Canvas drawing logic
- `src/server/websocket.js` - Position broadcasting
- `src/modules/rcon/client.js` - Player position retrieval

---

### 4. Player Profile System ✅

**What it tracks:**
- Player notes (staff can add/remove)
- Tags (VIP, Toxic, Streamer, etc.)
- Warning history with reasons
- Stats integration (kills, deaths, K/D, playtime)
- Activity data (first seen, last seen, days active)

**Technical Implementation:**
- Profile storage in `.data/player-profiles.json`
- Search functionality across IGN, tags, and notes
- Staff attribution for notes and warnings
- Auto-cleanup of inactive players (30 days)

**Files:**
- `src/modules/profiles/manager.js` - Profile management
- `src/server/admin/api.js` - API endpoints
- `src/data/store.js` - Persistence

**API Endpoints:**
- `GET /admin/api/profiles` - List/search profiles
- `GET /admin/api/profiles/:ign` - Get player profile
- `POST /admin/api/profiles/:ign/notes` - Add note
- `DELETE /admin/api/profiles/:ign/notes/:noteId` - Remove note
- `POST /admin/api/profiles/:ign/tags` - Add tag
- `DELETE /admin/api/profiles/:ign/tags/:tag` - Remove tag
- `POST /admin/api/profiles/:ign/warnings` - Add warning

---

## Installation & Setup

### Dependencies Added
```bash
npm install socket.io ws
```

### Environment Variables
No new environment variables required. Uses existing `ADMIN_PANEL_PASSWORD` and session authentication.

### Data Persistence
Three new data files in `.data/`:
- `analytics.json` - Analytics data
- `player-profiles.json` - Player profiles
- Connection via Railway volume `/app/.data`

---

## Usage Guide

### Accessing New Features

**Analytics Dashboard:**
1. Log into admin panel
2. Click "Analytics" in Server navigation
3. View real-time charts and metrics
4. Charts update automatically

**Live Map:**
1. Click "Live Map" in Server navigation
2. See players as blue dots on grid
3. Click "Profile" button to view player details
4. Updates automatically via WebSocket

**Player Profiles:**
1. Go to Players tab
2. Click player IGN to view profile
3. Add notes, tags, or warnings
4. View full stats and activity history

**Real-Time Updates:**
- Automatic - no action needed
- Toast notifications for kills/joins/leaves
- Status pills update in real-time
- Reconnects automatically if disconnected

---

## Performance Considerations

### Data Retention
- **Hourly data:** 7 days
- **Daily summaries:** 30 days  
- **Player profiles:** 30 days since last seen
- **Server performance:** Last 1 hour

### Update Intervals
- Player positions: Every 3 seconds
- Server stats: Every 3 seconds
- Analytics summary: Every 30 seconds
- Player count tracking: Every 60 seconds
- Server performance: Every 60 seconds

### WebSocket
- Authenticated per session
- Auto-reconnect on disconnect
- Efficient binary protocol
- Minimal bandwidth usage

---

## Future Enhancements

### Planned Features (Not Yet Implemented)
- Enhanced kit builder with visual item icons
- Player profile UI in admin panel
- Map click-to-teleport
- Historical analytics export (CSV)
- Custom map images/overlays
- Notification preferences
- Advanced filtering and search

---

## Troubleshooting

### WebSocket Not Connecting
- Check browser console for errors
- Verify `BOT_WEBHOOK_PORT` is accessible
- Ensure session is authenticated
- Try refreshing the page

### Charts Not Showing
- Ensure Chart.js CDN is loading
- Check browser console for errors
- Verify analytics data exists (`/admin/api/analytics`)
- Wait for data collection (may take a few minutes)

### Map Shows No Players
- Verify RCON is connected
- Check if players are actually online
- Ensure WebSocket is connected
- Player positions require RCON support

### Data Not Persisting
- Verify Railway volume is mounted at `/app/.data`
- Check DATA_DIR environment variable
- Review persistence warnings in logs
- Ensure write permissions on data directory

---

## API Reference

### Analytics API
```javascript
GET /admin/api/analytics
Response: {
  peak24h: number,
  avg24h: number,
  topWeapons: [{ weapon: string, kills: number }],
  avgFps: number,
  activePlayers: number,
  hourlyData: [{ hour: string, peak: number, samples: number }],
  performanceData: [{ timestamp: number, fps: number, entities: number, players: number }]
}
```

### Player Profile API
```javascript
GET /admin/api/profiles/:ign
Response: {
  ign: string,
  notes: [{ id: string, text: string, author: string, timestamp: string }],
  tags: string[],
  warnings: [{ id: string, reason: string, author: string, timestamp: string }],
  stats: { kills, deaths, kd, playtime, ... },
  activity: { firstSeen, lastSeen, daysActive, totalKills, totalDeaths }
}
```

### WebSocket Events
```javascript
// Server -> Client
server:update { rcon, server, onlineCount }
players:update [{ ign, ping, platform, coords, team }]
kill:new { killer, victim, weapon, distance, headshot, timestamp }
player:join { ign, timestamp }
player:leave { ign, timestamp }
alert:new { message, level, timestamp }

// Client -> Server
(authenticated connection only)
```

---

## Credits

Built for **Astral Vanilla+** Rust RCE server.  
Stack: Node.js, Socket.IO, Chart.js, Discord.js, Express, rce.js

Last Updated: 2026-07-26
