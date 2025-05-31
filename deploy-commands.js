require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("startgame")
    .setDescription("Begin the EXPOSED: Battle of Minds game"),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🔄 Refreshing application commands...");

    await rest.put(Routes.applicationCommands("1378276263268974642"), {
      body: commands,
    });

    console.log("✅ Slash command registered!");
  } catch (error) {
    console.error(error);
  }
})();
