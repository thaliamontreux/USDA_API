const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

class AdminStore {
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
    } catch (_) {
      this.state = null;
    }

    if (!this.state || !Array.isArray(this.state.users)) {
      const passwordHash = bcrypt.hashSync("admin", 12);
      this.state = {
        version: 1,
        users: [
          {
            id: newId(),
            username: "admin",
            passwordHash,
            mustChangePassword: true,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            totp: {
              enabled: false,
              secretBase32: "",
            },
            webauthn: {
              credentials: [],
            },
          },
        ],
      };
      await this.save();
    }

    return this.state;
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await ensureDir(dir);
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async getByUsername(username) {
    await this.load();
    const u = this.state.users.find((x) => x.username === username);
    return u || null;
  }

  async getById(id) {
    await this.load();
    const u = this.state.users.find((x) => x.id === id);
    return u || null;
  }

  async verifyPassword(username, password) {
    const u = await this.getByUsername(username);
    if (!u) return { ok: false, user: null };
    const ok = await bcrypt.compare(String(password || ""), u.passwordHash);
    return { ok, user: ok ? u : null };
  }

  async setPassword(userId, newPassword, mustChangePassword) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }

    u.passwordHash = bcrypt.hashSync(String(newPassword), 12);
    u.mustChangePassword = Boolean(mustChangePassword);
    u.updatedAt = nowIso();
    await this.save();

    return {
      id: u.id,
      username: u.username,
      mustChangePassword: u.mustChangePassword,
    };
  }

  async setTotpSecret(userId, secretBase32) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }

    u.totp.secretBase32 = String(secretBase32 || "");
    u.totp.enabled = false;
    u.updatedAt = nowIso();
    await this.save();
  }

  async enableTotp(userId, enabled) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }

    u.totp.enabled = Boolean(enabled);
    u.updatedAt = nowIso();
    await this.save();
  }

  async addWebAuthnCredential(userId, cred) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }

    u.webauthn.credentials.push({
      id: String(cred.id),
      publicKey: String(cred.publicKey),
      counter: Number(cred.counter || 0),
      transports: Array.isArray(cred.transports) ? cred.transports : [],
      createdAt: nowIso(),
    });

    u.updatedAt = nowIso();
    await this.save();
  }

  async updateWebAuthnCounter(userId, credentialId, counter) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) return;

    const c = u.webauthn.credentials.find((x) => x.id === credentialId);
    if (!c) return;

    c.counter = Number(counter || 0);
    u.updatedAt = nowIso();
    await this.save();
  }

  async listMfa(userId) {
    const u = await this.getById(userId);
    if (!u) return { totpEnabled: false, passkeys: 0 };
    return {
      totpEnabled: Boolean(u.totp && u.totp.enabled),
      passkeys: u.webauthn && Array.isArray(u.webauthn.credentials)
        ? u.webauthn.credentials.length
        : 0,
    };
  }
}

module.exports = { AdminStore };
