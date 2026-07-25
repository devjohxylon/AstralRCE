import { PermissionFlagsBits } from "discord.js";
import { config, isAdmin } from "../config.js";

export function isStaff(member) {
  if (!member) return false;
  if (isAdmin(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  return config.roles.staff.some((roleId) => member.roles.cache.has(roleId));
}

export function isAutomodExempt(member) {
  if (!member) return true;
  return isStaff(member);
}

export async function requireStaff(interaction) {
  const member = interaction.member;
  if (!isStaff(member)) {
    await interaction.reply({
      content: "You need staff permissions to use this command.",
      ephemeral: true,
    });
    return false;
  }
  return true;
}
