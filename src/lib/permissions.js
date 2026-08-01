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

function memberHasStaffRoleName(member) {
  const wanted = config.roles.staffNames;
  if (!wanted?.length) return false;

  // GuildMember — roles.cache is a Collection of Role
  if (member.roles?.cache?.some) {
    return member.roles.cache.some((role) =>
      wanted.includes(String(role.name || "").toLowerCase()),
    );
  }

  // APIInteractionGuildMember — roles is string[] of IDs; resolve names via guild
  if (Array.isArray(member.roles) && member.guild?.roles?.cache) {
    return member.roles.some((id) => {
      const role = member.guild.roles.cache.get(id);
      return role && wanted.includes(String(role.name || "").toLowerCase());
    });
  }

  return false;
}

function memberHasPermission(member, flag) {
  const perms = member?.permissions;
  if (!perms) return false;
  try {
    if (typeof perms.has === "function") return perms.has(flag);
    const bits = BigInt(perms);
    return (bits & BigInt(flag)) === BigInt(flag);
  } catch {
    return false;
  }
}

/**
 * Staff gate for slash commands / buttons.
 *
 * ONLY:
 *  - ADMIN_USER_IDS
 *  - Discord Administrator permission
 *  - ROLE_STAFF_IDS
 *  - Role names in ROLE_STAFF_NAMES (default: AstralAdmin)
 *
 * Moderate Members / Manage Messages do NOT count — those are too common.
 */
export function isStaff(member) {
  if (!member) return false;

  const userId = member.id || member.user?.id;
  if (isAdmin(userId)) return true;

  if (memberHasPermission(member, PermissionFlagsBits.Administrator)) return true;

  if (config.roles.staff.some((roleId) => memberHasRole(member, roleId))) {
    return true;
  }

  if (memberHasStaffRoleName(member)) return true;

  return false;
}

export function isAutomodExempt(member) {
  if (!member) return true;
  return isStaff(member);
}

export async function requireStaff(interaction) {
  let member = interaction.member;

  // Prefer a resolved GuildMember so role name checks work reliably
  if (interaction.guild && interaction.user?.id) {
    const fetched = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    if (fetched) member = fetched;
  }

  if (!isStaff(member)) {
    const msg = {
      content:
        "You need the **AstralAdmin** role (or another configured staff role) to use this command.",
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
