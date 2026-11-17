const crypto = require('crypto');

const MAGIC = Buffer.from('IVUENU01');

class LocalCipher {
  constructor(secure) { this.secure = secure; }

  key() {
    let encoded = this.secure.get('localDataKey');
    if (!encoded) {
      encoded = crypto.randomBytes(32).toString('base64');
      this.secure.set('localDataKey', encoded);
    }
    return Buffer.from(encoded, 'base64');
  }

  encrypted(data) { return data.subarray(0, MAGIC.length).equals(MAGIC); }

  seal(data, purpose) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), nonce);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
  }

  open(data, purpose) {
    if (!this.encrypted(data)) return data;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), data.subarray(8, 20));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(data.subarray(20, 36));
    return Buffer.concat([decipher.update(data.subarray(36)), decipher.final()]);
  }
}

module.exports = { LocalCipher };
