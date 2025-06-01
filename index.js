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

// ─── In‐Memory State ─────────────────────────────────────────
// gameState[guildId] = {
//   step: string,          // "awaiting_player_count" | "awaiting_player_names" | "choose_category" | "playing" | "awaiting_continue"
//   playerCount: number,
//   players: [string],     // list of player names
//   category: string,      // "extreme_18" | "18plus" | "life"
//   questionLog: { [playerName]: { category: string, question: string }[] },
//   lastRound: { playerName: string, question: string } | null,
//   lastPlayer: string | null // previously picked player (to avoid immediate repeats)
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
 * Builds a single Continue button (used after a dare is shown).
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
 * Builds Next/Skip buttons for the ongoing round.
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

  // ─── NEW “NO-STATE” BUTTON GUARD ────────────────────────────
  // If someone clicks a game button (#1) after typing "end" or (#2) before any /startgame, we give a polite reply.
  if (interaction.isButton()) {
    const validCustomIds = [
      "extreme_18",
      "18plus",
      "life",
      "next_question",
      "skip_question",
      "continue_game",
    ];
    if (validCustomIds.includes(interaction.customId) && !state) {
      return interaction.reply({
        content:
          "❌ There is no active game currently. Start a new game with `/startgame`.",
        ephemeral: true,
      });
    }
  }
  // ─── “NO-STATE” GUARD END ───────────────────────────────────

  // ─── 1) Slash Command “/startgame” ─────────────────────────
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "startgame") {
      // Initialize or reset the state for this guild
      gameState[guildId] = {
        step: "awaiting_player_count",
        players: [],
        playerCount: 0,
        category: null,
        questionLog: {},
        lastRound: null,
        lastPlayer: null,
      };

      // Embed: “How many players?”
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("🎮 Exposed: Battle of Minds")
        .setDescription("How many players are joining? (Enter a number 2–10)");

      await interaction.reply({ embeds: [embed] });
      return;
    }
  }

  // ─── 2) Category Selection button (only valid if state.step === "choose_category") ─────────────────────────
  if (interaction.isButton() && state && state.step === "choose_category") {
    const selectedCategory = interaction.customId; // "extreme_18", "18plus", or "life"
    state.category = selectedCategory;
    state.step = "playing";

    // Pick a random player (avoid repeats)
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

    // Build a BIGGER EMBED: player name is the title; question is in a field:
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

  // ─── 3) “Next Question” button click (player answered last one) ─────────────────────────
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

  // ─── 4) “Skip & Get Dare” button click ─────────────────────────
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

    // Embed: “You skipped—here’s your dare”
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

  // ─── 5) “Continue” button click (after a dare) → ask next question ─────────────────────────
  if (
    interaction.isButton() &&
    state &&
    state.step === "awaiting_continue" &&
    interaction.customId === "continue_game"
  ) {
    const selectedCategory = state.category;

    // Pick the next player & next question
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

// ─── Single MessageCreate Handler (with “end” keyword) ─────────────────────────
client.on(Events.MessageCreate, async (msg) => {
  // 1. Ignore bots
  if (msg.author.bot) return;

  const guildId = msg.guild?.id;
  const state = gameState[guildId];

  // 1.a) If user types "end", terminate the game session in this guild
  if (msg.content.trim().toLowerCase() === "end") {
    if (!state) {
      // No active game to end
      return msg.channel.send(
        "❌ No active game session to end in this channel."
      );
    }
    // Delete the in-memory state for this guild
    delete gameState[guildId];
    return msg.channel.send(
      "🛑 The game session has been ended. Thanks for playing!"
    );
  }

  // 2. “changecategory” keyword—only valid if we’re in “playing”:
  if (
    msg.content.trim().toLowerCase() === "changecategory" &&
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

  const content = msg.content.trim();

  // 3. STEP 1: Awaiting player count (only if state.step === "awaiting_player_count")
  if (state && state.step === "awaiting_player_count") {
    const count = parseInt(content);
    if (isNaN(count) || count < 2 || count > 10) {
      return msg.channel.send({
        content: "❌ Please enter a number between 2 and 10.",
      });
    }
    state.playerCount = count;
    state.step = "awaiting_player_names";

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("✅ PLAYERS COUNT SET")
      .setDescription(
        `You entered **${count}** players.\n\nNow, please enter all player names at once, separated by commas.\nExample: \`Alice,Bob,Charlie\`.`
      );

    return msg.channel.send({ embeds: [embed] });
  }

  // 4. STEP 2: Awaiting comma-separated player names
  if (state && state.step === "awaiting_player_names") {
    const names = content
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n);
    if (names.length !== state.playerCount) {
      return msg.channel.send({
        content: `❌ You specified ${state.playerCount} players. Please enter exactly ${state.playerCount} names, separated by commas.`,
      });
    }
    for (const name of names) {
      if (name.length < 2 || name.length > 20) {
        return msg.channel.send({
          content:
            "❌ Each name must be 2–20 characters long. Try again, comma-separated.",
        });
      }
    }
    state.players = names;
    state.step = "choose_category";

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("✅ PLAYERS REGISTERED")
      .setDescription(
        `Players: ${names.join(", ")}\n\nNow pick a category to begin:`
      );

    return msg.channel.send({
      embeds: [embed],
      components: [createCategoryButtons()],
    });
  }
});

// ─── Bot Login ────────────────────────────────────────────────
client.login(process.env.TOKEN);
