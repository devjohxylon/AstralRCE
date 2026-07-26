import { getScheduledEvents, saveScheduledEvents } from "../../data/store.js";
import { logAction } from "../audit/logger.js";
import { sendGameCommand } from "../rcon/client.js";

let cache = null;
let dirty = false;
let timers = new Map();

async function load() {
  if (!cache) {
    cache = await getScheduledEvents();
    if (!cache.events) cache.events = [];
  }
  return cache;
}

async function persist() {
  if (!dirty || !cache) return;
  await saveScheduledEvents(cache);
  dirty = false;
}

setInterval(() => persist().catch(() => {}), 30000);

export async function createEvent(name, command, schedule, admin, oneTime = false) {
  const data = await load();
  
  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    name,
    command,
    schedule,
    oneTime,
    enabled: true,
    createdBy: admin,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: calculateNextRun(schedule),
    runCount: 0,
  };
  
  data.events.push(event);
  dirty = true;
  
  await logAction("create_scheduled_event", {
    admin,
    target: name,
    extra: { command, schedule: schedule.type },
  });
  
  scheduleEvent(event);
  
  return { ok: true, event };
}

export async function updateEvent(id, updates, admin) {
  const data = await load();
  const event = data.events.find(e => e.id === id);
  
  if (!event) {
    return { ok: false, error: "Event not found" };
  }
  
  if (updates.name !== undefined) event.name = updates.name;
  if (updates.command !== undefined) event.command = updates.command;
  if (updates.enabled !== undefined) event.enabled = updates.enabled;
  if (updates.schedule !== undefined) {
    event.schedule = updates.schedule;
    event.nextRunAt = calculateNextRun(updates.schedule);
  }
  
  dirty = true;
  
  await logAction("update_scheduled_event", {
    admin,
    target: event.name,
    extra: updates,
  });
  
  rescheduleEvent(event);
  
  return { ok: true, event };
}

export async function deleteEvent(id, admin) {
  const data = await load();
  const index = data.events.findIndex(e => e.id === id);
  
  if (index === -1) {
    return { ok: false, error: "Event not found" };
  }
  
  const event = data.events[index];
  data.events.splice(index, 1);
  
  dirty = true;
  
  await logAction("delete_scheduled_event", {
    admin,
    target: event.name,
  });
  
  cancelEvent(id);
  
  return { ok: true };
}

export async function getAllEvents() {
  const data = await load();
  return [...data.events];
}

export async function runEventNow(id, admin) {
  const data = await load();
  const event = data.events.find(e => e.id === id);
  
  if (!event) {
    return { ok: false, error: "Event not found" };
  }
  
  try {
    const result = await runCommand(event.command);
    
    event.lastRunAt = new Date().toISOString();
    event.runCount++;
    dirty = true;
    
    await logAction("run_scheduled_event_manually", {
      admin,
      target: event.name,
      extra: { command: event.command, result },
    });
    
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function calculateNextRun(schedule) {
  const now = Date.now();
  
  if (schedule.type === "interval") {
    return new Date(now + schedule.minutes * 60 * 1000).toISOString();
  }
  
  if (schedule.type === "daily") {
    const [hours, minutes] = schedule.time.split(":").map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);
    
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1);
    }
    
    return next.toISOString();
  }
  
  if (schedule.type === "once") {
    return schedule.at;
  }
  
  return null;
}

function scheduleEvent(event) {
  if (!event.enabled || !event.nextRunAt) return;
  
  const delay = new Date(event.nextRunAt).getTime() - Date.now();
  if (delay <= 0) {
    executeEvent(event);
    return;
  }
  
  const timer = setTimeout(() => executeEvent(event), Math.min(delay, 2147483647));
  timers.set(event.id, timer);
}

async function executeEvent(event) {
  try {
    const result = await runCommand(event.command);
    
    const data = await load();
    const e = data.events.find(ev => ev.id === event.id);
    
    if (e) {
      e.lastRunAt = new Date().toISOString();
      e.runCount++;
      
      if (e.oneTime) {
        e.enabled = false;
      } else {
        e.nextRunAt = calculateNextRun(e.schedule);
        scheduleEvent(e);
      }
      
      dirty = true;
      
      await logAction("run_scheduled_event", {
        admin: "System",
        target: e.name,
        extra: { command: e.command, result },
      });
    }
  } catch (error) {
    console.error(`Failed to execute scheduled event ${event.name}:`, error);
  }
}

function rescheduleEvent(event) {
  cancelEvent(event.id);
  scheduleEvent(event);
}

function cancelEvent(id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export async function initScheduler() {
  const data = await load();
  
  for (const event of data.events) {
    if (event.enabled) {
      scheduleEvent(event);
    }
  }
  
  console.log(`Initialized ${data.events.length} scheduled event(s)`);
}
