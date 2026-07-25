import { sendModLog } from "./modlog.js";
import { config } from "../config.js";

export async function grantVipToWinners(guild, winnerIds, { prize, giveawayId }) {
  const vipRoleId = config.roles.vip;
  if (!vipRoleId || winnerIds.length === 0) {
    return { granted: [], skipped: winnerIds };
  }

  const role = guild.roles.cache.get(vipRoleId);
  if (!role) {
    console.warn(`ROLE_VIP ${vipRoleId} not found in guild`);
    return { granted: [], skipped: winnerIds, error: "VIP role not found" };
  }

  const granted = [];
  const skipped = [];

  for (const userId of winnerIds) {
    try {
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(vipRoleId)) {
        skipped.push(userId);
        continue;
      }
      await member.roles.add(vipRoleId, `Giveaway win: ${prize}`);
      granted.push(userId);

      await member
        .send(
          `🎉 You won **${prize}** in the Astral giveaway!\n\n` +
            `You've been given the **${role.name}** role on Discord. ` +
            `If your in-game VIP isn't applied within 24h, open a 💎 VIP ticket.`,
        )
        .catch(() => {});
    } catch (error) {
      console.error(`Failed to grant VIP to ${userId}:`, error.message);
      skipped.push(userId);
    }
  }

  if (granted.length > 0) {
    await sendModLog(guild, {
      title: "🎉 VIP role granted (giveaway)",
      description: `Prize: **${prize}**`,
      extra: {
        name: "Winners",
        value: granted.map((id) => `<@${id}>`).join(", "),
      },
    });
  }

  return { granted, skipped };
}
