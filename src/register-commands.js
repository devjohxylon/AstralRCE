import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandDefinitions } from "./commands/definitions.js";

const rest = new REST({ version: "10" }).setToken(config.discord.token);

async function register() {
  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commandDefinitions },
    );
    console.log(`Registered ${commandDefinitions.length} guild command(s)`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discord.clientId), {
    body: commandDefinitions,
  });
  console.log(`Registered ${commandDefinitions.length} global command(s)`);
}

register().catch((error) => {
  console.error("Failed to register commands:", error);
  process.exit(1);
});
