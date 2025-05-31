// utils/playerPicker.js

// Keeps track of who was picked last, per guild:
let lastPicked = {};

/**
 * Randomly selects a player from `players`, but never returns the same
 * name twice in a row (unless there is only one player in the list).
 *
 * @param {string} guildId
 * @param {string[]} players
 * @returns {string|null}
 */
function pickRandomPlayer(guildId, players) {
  if (!players || players.length === 0) return null;
  if (players.length === 1) return players[0];

  const previous = lastPicked[guildId];
  let eligible = players;

  if (previous) {
    // Exclude the last‐picked player if possible
    eligible = players.filter((p) => p !== previous);
    if (eligible.length === 0) {
      // If filtering left us with an empty list, fall back to the full list
      eligible = players;
    }
  }

  const picked = eligible[Math.floor(Math.random() * eligible.length)];
  lastPicked[guildId] = picked;
  return picked;
}

/**
 * (Optional) If you ever need to reset which player was last picked,
 * call this to clear that guild’s history.
 */
function resetLastPicked(guildId) {
  delete lastPicked[guildId];
}

module.exports = {
  pickRandomPlayer,
  resetLastPicked,
};
