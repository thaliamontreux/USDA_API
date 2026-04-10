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

function newId() {
  return crypto.randomUUID();
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
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      const now = new Date().toISOString();
      this.state = {
        version: 2,
        keys: [
          {
            id: "key1",
            ownerUsername: "admin",
            enabled: true,
            keyHash: sha256Hex(key1),
            last4: String(key1).slice(-4),
            createdAt: now,
            rotatedAt: now,
          },
          {
            id: "key2",
            ownerUsername: "admin",
            enabled: true,
            keyHash: sha256Hex(key2),
            last4: String(key2).slice(-4),
            createdAt: now,
            rotatedAt: now,
          },
        ],
      };
      await this.save();

      return { ...this.state, bootstrapKeys: { key1, key2 } };
    }

    let changed = false;
    if (!this.state.version || this.state.version < 2) {
      this.state.version = 2;
      changed = true;
    }

    for (const k of this.state.keys) {
      if (!k.ownerUsername) {
        k.ownerUsername = "admin";
        changed = true;
      }
      if (!k.id) {
        k.id = newId();
        changed = true;
      }
    }

    if (changed) await this.save();
    return this.state;
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await ensureDir(dir);
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async getById(id) {
    await this.load();
    const keyId = String(id || "");
    const k = this.state.keys.find((x) => String(x.id) === keyId);
    if (!k) return null;
    return {
      id: k.id,
      ownerUsername: k.ownerUsername || null,
      enabled: Boolean(k.enabled),
      last4: k.last4 || null,
      createdAt: k.createdAt || null,
      rotatedAt: k.rotatedAt || null,
    };
  }

  async list(ownerUsername = "") {
    await this.load();
    const o = String(ownerUsername || "").trim();
    const keys = o
      ? this.state.keys.filter((k) => String(k.ownerUsername || "") === o)
      : this.state.keys;
    return keys.map((k) => ({
      id: k.id,
      ownerUsername: k.ownerUsername || null,
      enabled: Boolean(k.enabled),
      last4: k.last4 || null,
      createdAt: k.createdAt || null,
      rotatedAt: k.rotatedAt || null,
    }));
  }

  async count(ownerUsername) {
    const keys = await this.list(ownerUsername);
    return keys.length;
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
    return {
      id: k.id,
      ownerUsername: k.ownerUsername || null,
      enabled: Boolean(k.enabled),
      last4: k.last4 || null,
    };
  }

  async revoke(id) {
    await this.load();
    const idx = this.state.keys.findIndex((x) => x.id === id);
    if (idx === -1) {
      const err = new Error("Unknown key id");
      err.statusCode = 400;
      throw err;
    }
    const k = this.state.keys[idx];
    this.state.keys.splice(idx, 1);
    await this.save();
    return { id: k.id, ownerUsername: k.ownerUsername || null };
  }

  async create(ownerUsername) {
    await this.load();
    const owner = String(ownerUsername || "").trim();
    if (!owner) {
      const err = new Error("Owner username required");
      err.statusCode = 400;
      throw err;
    }

    const key = generateApiKey();
    const now = new Date().toISOString();
    const rec = {
      id: newId(),
      ownerUsername: owner,
      enabled: true,
      keyHash: sha256Hex(key),
      last4: String(key).slice(-4),
      createdAt: now,
      rotatedAt: now,
    };
    this.state.keys.push(rec);
    await this.save();
    return { id: rec.id, ownerUsername: rec.ownerUsername, key, masked: maskKey(key) };
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

    return { id: k.id, ownerUsername: k.ownerUsername || null, key, masked: maskKey(key) };
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
