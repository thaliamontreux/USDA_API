const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function constantTimeEqualsHex(a, b) {
  try {
    const ab = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch (_) {
    return false;
  }
}

function generateApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

function maskKey(key) {
  const s = String(key || "");
  if (s.length <= 8) return "********";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

class KeyStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
  }

  async load() {
    if (this.state) return this.state;

    const dir = path.dirname(this.filePath);
    await ensureDir(dir);

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw);
    } catch (e) {
      this.state = null;
    }

    if (!this.state || !Array.isArray(this.state.keys)) {
      const { key: key1 } = await this.rotate("key1", true);
      const { key: key2 } = await this.rotate("key2", true);
      this.state = {
        version: 1,
        keys: [
          {
            id: "key1",
            enabled: true,
            keyHash: sha256Hex(key1),
            last4: String(key1).slice(-4),
            createdAt: new Date().toISOString(),
            rotatedAt: new Date().toISOString(),
          },
          {
            id: "key2",
            enabled: true,
            keyHash: sha256Hex(key2),
            last4: String(key2).slice(-4),
            createdAt: new Date().toISOString(),
            rotatedAt: new Date().toISOString(),
          },
        ],
      };
      await this.save();

      return { ...this.state, bootstrapKeys: { key1, key2 } };
    }

    return this.state;
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await ensureDir(dir);
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async list() {
    await this.load();
    return this.state.keys.map((k) => ({
      id: k.id,
      enabled: Boolean(k.enabled),
      last4: k.last4 || null,
      createdAt: k.createdAt || null,
      rotatedAt: k.rotatedAt || null,
    }));
  }

  async setEnabled(id, enabled) {
    await this.load();
    const k = this.state.keys.find((x) => x.id === id);
    if (!k) {
      const err = new Error("Unknown key id");
      err.statusCode = 400;
      throw err;
    }
    k.enabled = Boolean(enabled);
    await this.save();
    return { id: k.id, enabled: Boolean(k.enabled), last4: k.last4 || null };
  }

  async rotate(id, internal = false) {
    const key = generateApiKey();

    if (internal) {
      return { key };
    }

    await this.load();

    const now = new Date().toISOString();
    const k = this.state.keys.find((x) => x.id === id);
    if (!k) {
      const err = new Error("Unknown key id");
      err.statusCode = 400;
      throw err;
    }

    k.keyHash = sha256Hex(key);
    k.last4 = String(key).slice(-4);
    k.enabled = true;
    k.rotatedAt = now;
    if (!k.createdAt) k.createdAt = now;

    await this.save();

    return { id: k.id, key, masked: maskKey(key) };
  }

  async validateKey(apiKey) {
    if (!apiKey) return false;
    await this.load();
    const h = sha256Hex(apiKey);
    for (const k of this.state.keys) {
      if (!k.enabled) continue;
      if (constantTimeEqualsHex(k.keyHash, h)) return true;
    }
    return false;
  }
}

module.exports = {
  KeyStore,
  maskKey,
};
