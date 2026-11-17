const fs = require('fs');
const path = require('path');

/**
 * Small secrets (sign-in tokens, the calendar address) in one file encrypted with the operating system's credential
 * store (Electron safeStorage = Windows DPAPI). `crypto` is injected so tests can run without Electron; the plain
 * fallback is for tests only and refuses to run when `requireEncryption` is set.
 */
class SecureStore {
  constructor(file, crypto, { requireEncryption = true } = {}) {
    this.file = file;
    this.crypto = crypto;
    this.requireEncryption = requireEncryption;
  }

  _encrypted() { return !!(this.crypto && this.crypto.isEncryptionAvailable && this.crypto.isEncryptionAvailable() && (!this.crypto.getSelectedStorageBackend || this.crypto.getSelectedStorageBackend() !== 'basic_text')); }

  readAll() {
    let raw;
    try { raw = fs.readFileSync(this.file); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    if (!this._encrypted() && this.requireEncryption) throw new Error('Secure storage is not available on this computer');
    try {
      const text = this._encrypted() ? this.crypto.decryptString(raw) : raw.toString('utf8');
      return JSON.parse(text);
    } catch (error) {
      if (this.requireEncryption) throw error;
      return {};                         // unreadable (moved to another Windows account, damaged): start clean
    }
  }

  writeAll(obj) {
    if (!this._encrypted() && this.requireEncryption) {
      const e = new Error('Secure storage is not available on this computer'); e.code = 'no_secure_storage'; throw e;
    }
    const text = JSON.stringify(obj);
    const buf = this._encrypted() ? this.crypto.encryptString(text) : Buffer.from(text, 'utf8');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, buf, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  get(key) { return this.readAll()[key]; }

  set(key, value) {
    const all = this.readAll();
    if (value === undefined || value === null) delete all[key]; else all[key] = value;
    this.writeAll(all);
  }

  /** Forgets everything, except the entries named in `keep` (the local data key is shared by every account on this computer). */
  clear({ keep = [] } = {}) {
    if (keep.length) {
      try {
        const all = this.readAll();
        const kept = {};
        for (const key of keep) if (key in all) kept[key] = all[key];
        this.writeAll(kept);
        return;
      } catch { /* fall through to a full clear */ }
    }
    try { fs.rmSync(this.file, { force: true }); } catch { /* nothing to clear */ }
  }
}

module.exports = { SecureStore };
