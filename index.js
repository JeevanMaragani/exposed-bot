require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

// Helper that picks a random player without immediate repeats:
const { pickRandomPlayer } = require("./utils/playerPicker");

// ─── Import Category Questions ───────────────────────────────
const extreme_18 = require("./questions/extreme_18");
const eighteen_plus = require("./questions/18plus");
const life_questions = require("./questions/life");
const dares = require("./questions/dares");

// Map categories to their question arrays
const customQuestions = {
  extreme_18,
  "18plus": eighteen_plus,
  life: life_questions,
};

// ─── Discord Client Setup ────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── In-Memory State ──────────────────────────────────────────
// gameState[guildId] = {
//   step: string,               // "awaiting_player_count" | "awaiting_player_names" |
//                              // "warning" | "rules" | "choose_category" |
//                              // "playing" | "awaiting_continue"
//   hostId: string,             // Discord ID of who ran /startgame
//   playerCount: number,
//   playerIds: string[],        // Array of Discord IDs of participants
//   playerAliases: { [id]: string }, // Map ID → alias string
//   players: string[],          // Array of alias strings (same order as playerIds)
//   readyPlayers: Set<string>,  // IDs who clicked “I’M READY”
//   startPlayers: Set<string>,  // IDs who clicked “START GAME”
//   exitedWarning: Set<string>, // IDs who clicked “EXIT” at warning stage
//   exitedRules: Set<string>,   // IDs who clicked “EXIT” at rules stage
//   category: string,           // “extreme_18” | “18plus” | “life”
//   questionLog: { [alias]: { category: string, question: string }[] },
//   lastRound: { playerName: string, question: string } | null,
//   lastPlayer: string | null   // previously picked alias
// }
const gameState = {};

// A single embed color (Discord “blurple”)
const EMBED_COLOR = 0x5865f2;

// ─── Bot “Ready” Logger ───────────────────────────────────────
client.once("ready", () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
});

// ─── Helper Functions ────────────────────────────────────────

/**
 * Records that `playerName` answered `question` from `category`.
 */
function saveAnsweredQuestion(guildId, playerName, category, question) {
  if (!gameState[guildId].questionLog[playerName]) {
    gameState[guildId].questionLog[playerName] = [];
  }
  gameState[guildId].questionLog[playerName].push({ category, question });
}

/**
 * Records that `playerName` skipped `question` from `category` (prefix "(SKIPPED) ").
 */
function saveSkippedQuestion(guildId, playerName, category, question) {
  if (!gameState[guildId].questionLog[playerName]) {
    gameState[guildId].questionLog[playerName] = [];
  }
  gameState[guildId].questionLog[playerName].push({
    category,
    question: `(SKIPPED) ${question}`,
  });
}

/**
 * Returns one unused question for (guildId, playerName, category), or null if none left.
 */
function getNextQuestion(guildId, playerName, category) {
  const all = customQuestions[category] || [];
  const used =
    gameState[guildId].questionLog[playerName]?.map(
      (entry) => entry.question
    ) || [];
  const available = all.filter((q) => !used.includes(q));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Builds the “I’M READY 🔥” button.
 */
function createReadyButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("im_ready")
      .setLabel("I’M READY 🔥")
      .setStyle(ButtonStyle.Danger)
  );
}

/**
 * Builds a generic “EXIT ❌” button with the given customId.
 */
function createExitButton(customId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel("EXIT ❌")
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Builds the “START GAME ▶️” button.
 */
function createStartGameButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_game")
      .setLabel("START GAME ▶️")
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Builds category selection buttons.
 */
function createCategoryButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("extreme_18")
      .setLabel("Extreme 18+ 🔞")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("18plus")
      .setLabel("18+ 🔥")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("life")
      .setLabel("Life 🎭")
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Builds a single “Continue” button (used after a dare is shown).
 */
function createContinueButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("continue_game")
      .setLabel("▶️ Continue")
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Builds the Next/Skip buttons for the ongoing round.
 */
function createNextSkipButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("next_question")
      .setLabel("▶️ Next Question")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("skip_question")
      .setLabel("⏭️ Skip & Get Dare")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─── Handle Slash Commands & Button Clicks ──────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  const guildId = interaction.guild.id;
  const state = gameState[guildId];

  // ─── 0) NO-STATE & OUT-OF-TURN GUARD ─────────────────────────
  //
  // If someone clicks *any* of our custom buttons before the bot
  // is in the appropriate state, we return a polite ephemeral reply
  //
  if (interaction.isButton()) {
    const allButtonIds = [
      "im_ready",
      "exit_warning",
      "start_game",
      "exit_rules",
      "extreme_18",
      "18plus",
      "life",
      "next_question",
      "skip_question",
      "continue_game",
    ];

    // If it’s *one of ours* but we don’t have state at all:
    if (allButtonIds.includes(interaction.customId) && !state) {
      return interaction.reply({
        content:
          "❌ There is no active game currently. Start a new game with `/startgame`.",
        ephemeral: true,
      });
    }

    // If it’s “START GAME” but we’re not in the rules stage:
    if (
      interaction.customId === "start_game" &&
      (!state || state.step !== "rules")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until all players reach the Rules stage.",
        ephemeral: true,
      });
    }

    // If it’s “I’M READY” or “EXIT ❌ (warning)” but we’re not in warning stage:
    if (
      (interaction.customId === "im_ready" ||
        interaction.customId === "exit_warning") &&
      (!state || state.step !== "warning")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until the Warning stage is shown.",
        ephemeral: true,
      });
    }

    // If it’s “EXIT ❌ (rules)” but we’re not in rules stage:
    if (
      interaction.customId === "exit_rules" &&
      (!state || state.step !== "rules")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until the Rules stage is shown.",
        ephemeral: true,
      });
    }

    // If it’s a category button but we’re not choosing category:
    if (
      ["extreme_18", "18plus", "life"].includes(interaction.customId) &&
      (!state || state.step !== "choose_category")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until category selection is open.",
        ephemeral: true,
      });
    }

    // If it’s Next/Skip/Continue but we’re not in “playing” or “awaiting_continue”:
    if (
      ["next_question", "skip_question"].includes(interaction.customId) &&
      (!state || state.step !== "playing")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until the game is in progress.",
        ephemeral: true,
      });
    }
    if (
      interaction.customId === "continue_game" &&
      (!state || state.step !== "awaiting_continue")
    ) {
      return interaction.reply({
        content: "⏳ Please wait until your dare is shown.",
        ephemeral: true,
      });
    }
  }
  // ─── NO-STATE & OUT-OF-TURN GUARD END ───────────────────────

  // ─── 1) Slash Command “/startgame” ─────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "startgame") {
      // Initialize (or reset) the state for this guild
      gameState[guildId] = {
        step: "awaiting_player_count",
        hostId: interaction.user.id,
        playerCount: 0,
        playerIds: [],
        playerAliases: {},
        players: [],
        readyPlayers: new Set(),
        startPlayers: new Set(),
        exitedWarning: new Set(),
        exitedRules: new Set(),
        category: null,
        questionLog: {},
        lastRound: null,
        lastPlayer: null,
      };

      // Ask for number of players
      const countEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("🎮 Exposed: Battle of Minds")
        .setDescription("Please enter the number of players (2–10).");

      await interaction.reply({ embeds: [countEmbed] });
      return;
    }
  }

  // ─── 2) “I’M READY 🔥” or “EXIT ❌” Buttons (Warning stage) ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "warning" &&
    (interaction.customId === "im_ready" ||
      interaction.customId === "exit_warning")
  ) {
    const userId = interaction.user.id;

    // If user is not in the mention list, ignore
    if (!state.playerIds.includes(userId)) {
      return interaction.reply({
        content: "❌ You are not a listed player for this game.",
        ephemeral: true,
      });
    }

    // If they clicked “I’M READY”
    if (interaction.customId === "im_ready") {
      if (!state.readyPlayers.has(userId)) {
        state.readyPlayers.add(userId);
      }
      // If they had previously exited, remove that
      state.exitedWarning.delete(userId);
    }

    // If they clicked “EXIT” at warning
    if (interaction.customId === "exit_warning") {
      if (!state.exitedWarning.has(userId)) {
        state.exitedWarning.add(userId);
      }
      // Remove from readyPlayers if present
      state.readyPlayers.delete(userId);
    }

    // Build lists of aliases for display
    const readyAliases = Array.from(state.readyPlayers).map(
      (id) => state.playerAliases[id]
    );
    const exitedAliases = Array.from(state.exitedWarning).map(
      (id) => state.playerAliases[id]
    );

    // Construct the Warning embed showing who clicked what
    const mentionList = state.playerIds.map((id) => `<@${id}>`).join(", ");
    let warningDesc =
      `These are your players: ${mentionList}\n\n` +
      "⚠️ **WARNING**\n" +
      "This game is not for the weak-hearted.\n" +
      "It will test your courage, vulnerability, and honesty.\n" +
      "If you're afraid to face your own truth—**do not play**.\n\n" +
      "This is your chance to be real. To drop the mask. To expose yourself.\n\n";
    if (readyAliases.length > 0) {
      warningDesc += `✅ Ready: ${readyAliases.join(", ")}\n`;
    }
    if (exitedAliases.length > 0) {
      warningDesc += `❌ Exited: ${exitedAliases.join(", ")}\n`;
    }
    warningDesc +=
      "\n➤ Click **“I’M READY 🔥”** to stay, or **“EXIT ❌”** to quit.";

    const warningEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("⚠️ WARNING")
      .setDescription(warningDesc);

    // Check if all have made a choice
    const totalChoices = state.readyPlayers.size + state.exitedWarning.size;
    if (totalChoices === state.playerIds.length) {
      // Filter out any who exited
      state.playerIds = state.playerIds.filter(
        (id) => !state.exitedWarning.has(id)
      );
      state.players = state.playerIds.map((id) => state.playerAliases[id]);

      // If fewer than 2 remain, cancel game
      if (state.players.length < 2) {
        delete gameState[guildId];
        return interaction.update({
          content: "❌ Not enough players remain. Game canceled.",
          embeds: [],
          components: [],
        });
      }

      // Move to rules stage
      state.step = "rules";

      const playersMention = state.playerIds.map((id) => `<@${id}>`).join(", ");
      const rulesEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("✅ All set.")
        .setDescription(
          `These are your players: ${playersMention}\n\n` +
            "⚔️ **Rules of the Game:**\n" +
            "1. “Answer honestly or skip and face the dare.”\n" +
            "2. “No judgment. No filters. No pretending.”\n" +
            "3. “If you lie—you lose.”\n\n" +
            'When you\'re ready... click **"START GAME ▶️"** to begin the first question, or **“EXIT ❌”** to quit.'
        );

      return interaction.update({
        embeds: [rulesEmbed],
        components: [createStartGameButton(), createExitButton("exit_rules")],
      });
    }

    // Otherwise, just update the warning embed
    return interaction.update({
      embeds: [warningEmbed],
      components: [createReadyButton(), createExitButton("exit_warning")],
    });
  }

  // ─── 3) “START GAME ▶️” Button during rules stage ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "rules" &&
    interaction.customId === "start_game"
  ) {
    const userId = interaction.user.id;

    // If user is not in the “remaining players” list, ignore
    if (!state.playerIds.includes(userId)) {
      return interaction.reply({
        content: "❌ You are not a listed player for this game.",
        ephemeral: true,
      });
    }

    // Mark as “wants to start”
    if (!state.startPlayers.has(userId)) {
      state.startPlayers.add(userId);
    }
    // If they had clicked exit at rules, remove that
    state.exitedRules.delete(userId);

    // Build lists of aliases for display
    const clickedAliases = Array.from(state.startPlayers).map(
      (id) => state.playerAliases[id]
    );
    const exitedAliases = Array.from(state.exitedRules).map(
      (id) => state.playerAliases[id]
    );
    const waitingIds = state.playerIds.filter(
      (id) => !state.startPlayers.has(id) && !state.exitedRules.has(id)
    );
    const waitingAliases = waitingIds.map((id) => state.playerAliases[id]);

    let rulesDesc =
      `These are your players: ${state.playerIds
        .map((id) => `<@${id}>`)
        .join(", ")}\n\n` +
      "⚔️ **Rules of the Game:**\n" +
      "1. “Answer honestly or skip and face the dare.”\n" +
      "2. “No judgment. No filters. No pretending.”\n" +
      "3. “If you lie—you lose.”\n\n";
    if (clickedAliases.length > 0) {
      rulesDesc += `✅ ${clickedAliases.join(", ")} clicked START GAME\n`;
    }
    if (exitedAliases.length > 0) {
      rulesDesc += `❌ ${exitedAliases.join(", ")} clicked EXIT\n`;
    }
    if (waitingAliases.length > 0) {
      rulesDesc += `⏳ Waiting for: ${waitingAliases.join(", ")}\n`;
    } else {
      rulesDesc += `✅ All players clicked START GAME\n`;
    }
    rulesDesc +=
      "\nBy clicking **“START GAME ▶️”**, you accept these rules and agree to play.";

    const rulesEmbedUpdate = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("✅ Rules of the Game")
      .setDescription(rulesDesc);

    // Check if everyone has chosen at rules
    const totalRulesChoices = state.startPlayers.size + state.exitedRules.size;
    if (totalRulesChoices === state.playerIds.length) {
      // Filter out any who exited at rules
      state.playerIds = state.playerIds.filter(
        (id) => !state.exitedRules.has(id)
      );
      state.players = state.playerIds.map((id) => state.playerAliases[id]);

      // If fewer than 2 remain, cancel game
      if (state.players.length < 2) {
        delete gameState[guildId];
        return interaction.update({
          content: "❌ Not enough players remain. Game canceled.",
          embeds: [],
          components: [],
        });
      }

      // Move to category selection
      state.step = "choose_category";

      const categoryEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("✅ PLAYERS REGISTERED")
        .setDescription(
          `Players: ${state.players.join(
            ", "
          )}\n\nNow pick a category to begin:`
        );

      return interaction.update({
        embeds: [categoryEmbed],
        components: [createCategoryButtons()],
      });
    }

    // Otherwise, just update the rules embed
    return interaction.update({
      embeds: [rulesEmbedUpdate],
      components: [createStartGameButton(), createExitButton("exit_rules")],
    });
  }

  // ─── 4) Category Selection button (only valid if state.step === "choose_category") ─────────────────────────
  if (interaction.isButton() && state && state.step === "choose_category") {
    const selectedCategory = interaction.customId; // "extreme_18", "18plus", or "life"
    state.category = selectedCategory;
    state.step = "playing";

    // Pick a random alias (avoid immediate repeats)
    const chosenPlayer = pickRandomPlayer(guildId, state.players);
    state.lastPlayer = chosenPlayer;

    // Get a question
    const question = getNextQuestion(guildId, chosenPlayer, selectedCategory);
    if (!question) {
      const outEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("✅ ALL QUESTIONS FINISHED")
        .setDescription(
          `All questions in **${selectedCategory
            .replace("_", " ")
            .toUpperCase()}** have been used.`
        );
      return interaction.reply({ embeds: [outEmbed] });
    }

    saveAnsweredQuestion(guildId, chosenPlayer, selectedCategory, question);
    state.lastRound = { playerName: chosenPlayer, question: question };

    // Build the question embed: alias is the title
    const questionEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🎲 ${chosenPlayer.toUpperCase()}'S TURN`)
      .addFields([
        {
          name: "❓ QUESTION",
          value: `**${question}**`,
          inline: false,
        },
      ])
      .setFooter({ text: "🎤 Please respond with your answer below." });

    await interaction.reply({
      embeds: [questionEmbed],
      components: [createNextSkipButtons()],
    });
    return;
  }

  // ─── 5) “Next Question” button click (player answered last one) ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "playing" &&
    interaction.customId === "next_question"
  ) {
    const selectedCategory = state.category;
    const chosenPlayer = pickRandomPlayer(guildId, state.players);
    state.lastPlayer = chosenPlayer;

    const question = getNextQuestion(guildId, chosenPlayer, selectedCategory);
    if (!question) {
      const doneEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("✅ ALL QUESTIONS COMPLETED")
        .setDescription(
          `All questions in **${selectedCategory
            .replace("_", " ")
            .toUpperCase()}** have been exhausted.`
        );
      await interaction.reply({ embeds: [doneEmbed] });
      return;
    }

    saveAnsweredQuestion(guildId, chosenPlayer, selectedCategory, question);
    state.lastRound = { playerName: chosenPlayer, question: question };

    const questionEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🎲 ${chosenPlayer.toUpperCase()}'S TURN`)
      .addFields([
        {
          name: "❓ QUESTION",
          value: `**${question}**`,
          inline: false,
        },
      ])
      .setFooter({ text: "🎤 Please respond with your answer below." });

    await interaction.reply({
      embeds: [questionEmbed],
      components: [createNextSkipButtons()],
    });
    return;
  }

  // ─── 6) “Skip & Get Dare” button click ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "playing" &&
    interaction.customId === "skip_question"
  ) {
    // Identify who skipped from the lastRound
    const skipper = state.lastRound?.playerName;

    // Record that the last question was skipped
    if (skipper && state.lastRound) {
      const { question } = state.lastRound;
      saveSkippedQuestion(guildId, skipper, state.category, question);
    }

    // Pick a random dare for the skipper
    const dare = dares[Math.floor(Math.random() * dares.length)];

    // Move state into “awaiting_continue” so we wait for a Continue click
    state.step = "awaiting_continue";

    // Build the dare embed
    const dareEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("⏭️ YOU SKIPPED!")
      .addFields([
        {
          name: `🔥 DARE FOR ${skipper.toUpperCase()}`,
          value: `**${dare}**`,
          inline: false,
        },
      ])
      .setFooter({ text: "▶️ Click Continue when you’re done." });

    await interaction.reply({
      embeds: [dareEmbed],
      components: [createContinueButton()],
    });
    return;
  }

  // ─── 7) “Continue” button click (after a dare) → ask next question ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "awaiting_continue" &&
    interaction.customId === "continue_game"
  ) {
    const selectedCategory = state.category;

    // Pick the next alias & next question
    const chosenPlayer = pickRandomPlayer(guildId, state.players);
    state.lastPlayer = chosenPlayer;

    const nextQuestion = getNextQuestion(
      guildId,
      chosenPlayer,
      selectedCategory
    );
    if (!nextQuestion) {
      const noMoreEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("❌ ALL QUESTIONS GONE")
        .setDescription(
          `All questions in **${selectedCategory
            .replace("_", " ")
            .toUpperCase()}** are exhausted.`
        );
      await interaction.reply({ embeds: [noMoreEmbed] });
      return;
    }

    saveAnsweredQuestion(guildId, chosenPlayer, selectedCategory, nextQuestion);
    state.lastRound = { playerName: chosenPlayer, question: nextQuestion };
    state.step = "playing";

    const questionEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🎲 ${chosenPlayer.toUpperCase()}'S TURN`)
      .addFields([
        {
          name: "❓ QUESTION",
          value: `**${nextQuestion}**`,
          inline: false,
        },
      ])
      .setFooter({ text: "🎤 Please respond with your answer below." });

    await interaction.reply({
      embeds: [questionEmbed],
      components: [createNextSkipButtons()],
    });
    return;
  }
});

// ─── Single MessageCreate Handler (with “end” and mention+alias parsing) ─────────────────────────
client.on(Events.MessageCreate, async (msg) => {
  // 1. Ignore bots
  if (msg.author.bot) return;

  const guildId = msg.guild?.id;
  const state = gameState[guildId];
  const content = msg.content.trim();

  // 1.a) If user types "end", terminate the game session in this guild
  if (content.toLowerCase() === "end") {
    if (!state) {
      return msg.channel.send(
        "❌ No active game session to end in this channel."
      );
    }
    delete gameState[guildId];
    return msg.channel.send(
      "🛑 The game session has been ended. Thanks for playing!"
    );
  }

  // 2. Awaiting player count
  if (state && state.step === "awaiting_player_count") {
    const count = parseInt(content);
    if (isNaN(count) || count < 2 || count > 10) {
      return msg.channel.send({
        content: "❌ Please enter a number between 2 and 10.",
      });
    }
    state.playerCount = count;
    state.step = "awaiting_player_names";

    return msg.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("✅ PLAYERS COUNT SET")
          .setDescription(
            `You entered **${count}** players.\n\n` +
              "Now, please @mention each player **and** their alias, using `as`.\n" +
              "Example: `@david696 as Jeevan, @alice123 as Priya, @bob789 as Rohit`"
          ),
      ],
    });
  }

  // 3. Awaiting mention+alias list
  if (state && state.step === "awaiting_player_names") {
    // Expect format: <@id> as Alias, <@id2> as Alias2, ...
    const parts = content.split(",").map((p) => p.trim());
    if (parts.length !== state.playerCount) {
      return msg.channel.send({
        content: `❌ You said there would be ${state.playerCount} players, but I see ${parts.length} entries. Please @mention exactly ${state.playerCount} users with aliases.`,
      });
    }

    const tempIds = [];
    const tempAliases = {};
    let parseError = false;

    for (const part of parts) {
      // Regex to capture mention and alias: <@!?\d+> as Alias
      const match = part.match(/^<@!?(\d+)> as (.+)$/);
      if (!match) {
        parseError = true;
        break;
      }
      const userId = match[1];
      const alias = match[2].trim();
      if (alias.length < 1 || alias.length > 20) {
        parseError = true;
        break;
      }
      tempIds.push(userId);
      tempAliases[userId] = alias;
    }

    if (parseError) {
      return msg.channel.send({
        content:
          "❌ Invalid format. Make sure you use `@mention as Alias`, separated by commas. Example:\n" +
          "`@david696 as Jeevan, @alice123 as Priya, @bob789 as Rohit`",
      });
    }

    // All good: store in state
    state.playerIds = tempIds;
    state.playerAliases = tempAliases;
    state.players = tempIds.map((id) => tempAliases[id]);
    state.step = "warning";

    // Build and send the Warning embed
    const mentionList = state.playerIds.map((id) => `<@${id}>`).join(", ");
    const warningEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("⚠️ WARNING")
      .setDescription(
        `These are your players: ${mentionList}\n\n` +
          "⚠️ **WARNING**\n" +
          "This game is not for the weak-hearted.\n" +
          "It will test your courage, vulnerability, and honesty.\n" +
          "If you're afraid to face your own truth—**do not play**.\n\n" +
          "This is your chance to be real. To drop the mask. To expose yourself.\n\n" +
          "➤ Click **“I’M READY 🔥”** to stay, or **“EXIT ❌”** to quit."
      );

    return msg.channel.send({
      embeds: [warningEmbed],
      components: [createReadyButton(), createExitButton("exit_warning")],
    });
  }

  // 4. “changecategory” keyword—only valid if state.step === “playing”
  if (
    content.toLowerCase() === "changecategory" &&
    state &&
    state.step === "playing"
  ) {
    state.step = "choose_category";

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🔄 CHANGE CATEGORY")
      .setDescription("You requested a new category! Please pick one below:");

    return msg.channel.send({
      embeds: [embed],
      components: [createCategoryButtons()],
    });
  }
});

// ─── Bot Login ────────────────────────────────────────────────
client.login(process.env.TOKEN);
