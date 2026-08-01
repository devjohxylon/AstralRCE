import { pathToFileURL } from "url";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandDefinitions } from "./commands/definitions.js";

export async function registerDiscordCommands() {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commandDefinitions },
    );
    console.log(`Registered ${commandDefinitions.length} guild command(s)`);
    return { scope: "guild", count: commandDefinitions.length };
  }

  await rest.put(Routes.applicationCommands(config.discord.clientId), {
    body: commandDefinitions,
  });
  console.log(`Registered ${commandDefinitions.length} global command(s)`);
  return { scope: "global", count: commandDefinitions.length };
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  registerDiscordCommands().catch((error) => {
    console.error("Failed to register commands:", error);
    process.exit(1);
  });
}
