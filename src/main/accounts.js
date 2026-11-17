const fs = require('fs');
const path = require('path');

/**
 * One folder of local data per account, so signing out and signing in as someone else never mixes meetings and never needs an erase.
 *
 *   <userData>/active-account.json     { id }   which account's folder the app opens at start-up
 *   <userData>/accounts/<id>/          ivuenu-data.json, audio/, ivuenu-secure.bin (that account's own small secrets while it is not signed in)
 *
 * Shared on purpose: the voice models (large, not private), and the main secure store with the sign-in tokens.
 * Older versions kept everything straight in <userData>; migrateLegacy() moves that into its owner's folder.
 */
const POINTER = 'active-account.json';
const DATA_FILE = 'ivuenu-data.json';
// Entries of the main secure store that belong to one account and must not follow another account around.
const ACCOUNT_KEYS = ['calendarAuth', 'calendarUrl', 'pendingUsage', 'serverUsage'];

const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
const accountDir = (userData, id) => {
  const name = safeId(id);
  if (!name) throw new Error('account id missing');
  return path.join(userData, 'accounts', name);
};

function getActive(userData) {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(userData, POINTER), 'utf8')).id;
    return typeof id === 'string' && safeId(id) ? id : null;
  } catch { return null; }
}

function setActive(userData, id) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, POINTER);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Moves the single-folder data (data file + audio) of `ownerId` into accounts/<ownerId>. Never overwrites: returns false if that folder already has data. */
function migrateLegacy(userData, ownerId) {
  const legacy = path.join(userData, DATA_FILE);
  if (!fs.existsSync(legacy)) return false;
  const dir = accountDir(userData, ownerId);
  if (fs.existsSync(path.join(dir, DATA_FILE))) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(legacy, path.join(dir, DATA_FILE));
  const audio = path.join(userData, 'audio');
  if (fs.existsSync(audio) && !fs.existsSync(path.join(dir, 'audio'))) fs.renameSync(audio, path.join(dir, 'audio'));
  return true;
}

/** Moves the account-bound secrets from the main secure store into `target` (a SecureStore in that account's folder), and removes them from the main one. */
function stashKeys(main, target, keys = ACCOUNT_KEYS) {
  for (const key of keys) {
    const value = main.get(key);
    if (value !== undefined) { target.set(key, value); main.set(key, null); }
  }
}

/** The reverse: brings an account's secrets back into the main secure store when it becomes the signed-in account. */
function restoreKeys(main, source, keys = ACCOUNT_KEYS) {
  for (const key of keys) {
    const value = source.get(key);
    if (value !== undefined) { main.set(key, value); source.set(key, null); }
  }
}

module.exports = { ACCOUNT_KEYS, DATA_FILE, accountDir, getActive, setActive, migrateLegacy, stashKeys, restoreKeys };
