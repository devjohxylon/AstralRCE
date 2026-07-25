import { getAutoMessages, saveAutoMessages } from "../../data/store.js";

// Reuse auto-messages file shape, extend with scheduled RCON jobs in scheduler.json via store

export async function listAutoMessages() {
  const data = await getAutoMessages();
  return data.messages ?? [];
}

export async function addAutoMessage(text, intervalMinutes = 15) {
  const data = await getAutoMessages();
  if (!data.messages) data.messages = [];
  const message = {
    id: crypto.randomUUID().slice(0, 8),
    text: String(text).slice(0, 200),
    intervalMinutes: Math.max(1, Number(intervalMinutes) || 15),
    enabled: true,
    lastSentAt: null,
  };
  data.messages.push(message);
  await saveAutoMessages(data);
  return message;
}

export async function removeAutoMessage(id) {
  const data = await getAutoMessages();
  const before = (data.messages ?? []).length;
  data.messages = (data.messages ?? []).filter((m) => m.id !== id);
  if (data.messages.length === before) return { ok: false, error: "Message not found." };
  await saveAutoMessages(data);
  return { ok: true };
}

export async function toggleAutoMessage(id, enabled) {
  const data = await getAutoMessages();
  const message = (data.messages ?? []).find((m) => m.id === id);
  if (!message) return { ok: false, error: "Message not found." };
  message.enabled = enabled;
  await saveAutoMessages(data);
  return { ok: true, message };
}

export async function updateAutoMessage(id, patch) {
  const data = await getAutoMessages();
  const message = (data.messages ?? []).find((m) => m.id === id);
  if (!message) return { ok: false, error: "Message not found." };
  if (patch.text != null) message.text = String(patch.text).slice(0, 200);
  if (patch.intervalMinutes != null) {
    message.intervalMinutes = Math.max(1, Number(patch.intervalMinutes) || 15);
  }
  if (patch.enabled != null) message.enabled = Boolean(patch.enabled);
  await saveAutoMessages(data);
  return { ok: true, message };
}
