// utils/playerPicker.js

// For each guild, we maintain a queue (array) of players yet to be picked this “cycle.”
const guildQueues = {};

/**
 * Fisher–Yates shuffle in-place
 * @param {any[]} array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

/**
 * Randomly selects a player from `players` such that:
 *  • No one repeats until everyone else has been picked.
 *  • Once the “queue” is exhausted, we reshuffle and start a new cycle.
 *
 * @param {string} guildId
 * @param {string[]} players  // array of alias strings
 * @returns {string|null}
 */
function pickRandomPlayer(guildId, players) {
  if (!players || players.length === 0) return null;
  // If there’s only one player, always return them:
  if (players.length === 1) return players[0];

  // If the queue doesn't exist or its contents differ from `players`, (re)build it:
  const queue = guildQueues[guildId] || [];
  const sameContents =
    queue.length === players.length && queue.every((p) => players.includes(p));

  if (!sameContents || queue.length === 0) {
    // Reinitialize: make a fresh shuffled copy of `players`
    guildQueues[guildId] = [...players];
    shuffleArray(guildQueues[guildId]);
  }

  // Pop the next player out of the queue:
  const next = guildQueues[guildId].shift();
  // (If for some corner-case shift() returns undefined, fallback to random pick:)
  if (!next) {
    const idx = Math.floor(Math.random() * players.length);
    return players[idx];
  }
  return next;
}

/**
 * Resets a guild’s queue completely (next call to pickRandomPlayer will re-shuffle).
 */
function resetLastPicked(guildId) {
  delete guildQueues[guildId];
}

module.exports = {
  pickRandomPlayer,
  resetLastPicked,
};
