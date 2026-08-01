import { PermissionFlagsBits } from "discord.js";
import { config, isAdmin } from "../config.js";

function memberHasRole(member, roleId) {
  if (!member || !roleId) return false;
  const roles = member.roles;
  if (!roles) return false;
  // GuildMember → roles.cache; APIInteractionGuildMember → string[]
  if (roles.cache?.has) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

function memberHasPermission(member, flag) {
  const perms = member?.permissions;
  if (!perms) return false;
  try {
    if (typeof perms.has === "function") return perms.has(flag);
    // Raw bitfield string from the interaction payload
    const bits = BigInt(perms);
    return (bits & BigInt(flag)) === BigInt(flag);
  } catch {
    return false;
  }
}

/**
 * Staff gate for slash commands / buttons.
 * Intentionally does NOT treat Manage Messages as staff — that permission is
 * often granted to community roles via channel overwrites.
 */
export function isStaff(member) {
  if (!member) return false;

  const userId = member.id || member.user?.id;
  if (isAdmin(userId)) return true;

  if (memberHasPermission(member, PermissionFlagsBits.Administrator)) return true;

  if (config.roles.staff.some((roleId) => memberHasRole(member, roleId))) {
    return true;
  }

  // Real mod bit at guild/role level — not ManageMessages
  if (memberHasPermission(member, PermissionFlagsBits.ModerateMembers)) return true;

  return false;
}

export function isAutomodExempt(member) {
  if (!member) return true;
  return isStaff(member);
}

export async function requireStaff(interaction) {
  let member = interaction.member;

  // Prefer a resolved GuildMember so role/permission checks are guild-scoped
  if (interaction.guild && interaction.user?.id) {
    const fetched = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (fetched) member = fetched;
  }

  if (!isStaff(member)) {
    const msg = {
      content: "You need staff permissions to use this command.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
    return false;
  }
  return true;
}
