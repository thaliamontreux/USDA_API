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

function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "admin") return "admin";
  return "user";
}

function normalizeKeyLimit(limit) {
  if (limit === null || limit === undefined || limit === "") return 5;
  const n = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(n) || n < 0) return 5;
  return n;
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
            role: "admin",
            apiKeyLimit: 5,
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
    } else {
      let changed = false;
      for (const u of this.state.users) {
        if (!u.role) {
          u.role = u.username === "admin" ? "admin" : "user";
          changed = true;
        } else {
          const nr = normalizeRole(u.role);
          if (nr !== u.role) {
            u.role = nr;
            changed = true;
          }
        }

        if (u.apiKeyLimit === undefined || u.apiKeyLimit === null || u.apiKeyLimit === "") {
          u.apiKeyLimit = 5;
          changed = true;
        } else {
          const nl = normalizeKeyLimit(u.apiKeyLimit);
          if (nl !== u.apiKeyLimit) {
            u.apiKeyLimit = nl;
            changed = true;
          }
        }

        if (!u.totp) {
          u.totp = { enabled: false, secretBase32: "" };
          changed = true;
        }
        if (!u.webauthn) {
          u.webauthn = { credentials: [] };
          changed = true;
        }
        if (!Array.isArray(u.webauthn.credentials)) {
          u.webauthn.credentials = [];
          changed = true;
        }
      }
      if (changed) await this.save();
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

  async listUsers() {
    await this.load();
    return this.state.users
      .slice()
      .sort((a, b) => String(a.username).localeCompare(String(b.username)))
      .map((u) => ({
        id: u.id,
        username: u.username,
        role: normalizeRole(u.role),
        apiKeyLimit: normalizeKeyLimit(u.apiKeyLimit),
        mustChangePassword: Boolean(u.mustChangePassword),
        createdAt: u.createdAt || null,
        updatedAt: u.updatedAt || null,
      }));
  }

  async createUser({ username, password, role, apiKeyLimit }) {
    await this.load();
    const uname = String(username || "").trim();
    if (!uname) {
      const err = new Error("Username required");
      err.statusCode = 400;
      throw err;
    }

    const exists = this.state.users.find((x) => x.username === uname);
    if (exists) {
      const err = new Error("Username already exists");
      err.statusCode = 400;
      throw err;
    }

    const pw = String(password || "");
    if (pw.length < 6) {
      const err = new Error("Password must be at least 6 characters");
      err.statusCode = 400;
      throw err;
    }

    const u = {
      id: newId(),
      username: uname,
      role: normalizeRole(role),
      apiKeyLimit: normalizeKeyLimit(apiKeyLimit),
      passwordHash: bcrypt.hashSync(pw, 12),
      mustChangePassword: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      totp: { enabled: false, secretBase32: "" },
      webauthn: { credentials: [] },
    };

    this.state.users.push(u);
    await this.save();
    return { id: u.id, username: u.username, role: u.role, apiKeyLimit: u.apiKeyLimit };
  }

  async setRole(userId, role) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }
    u.role = normalizeRole(role);
    u.updatedAt = nowIso();
    await this.save();
    return { id: u.id, username: u.username, role: u.role };
  }

  async setApiKeyLimit(userId, apiKeyLimit) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }
    u.apiKeyLimit = normalizeKeyLimit(apiKeyLimit);
    u.updatedAt = nowIso();
    await this.save();
    return { id: u.id, username: u.username, apiKeyLimit: u.apiKeyLimit };
  }

  async resetPassword(userId, newPassword) {
    await this.load();
    const u = this.state.users.find((x) => x.id === userId);
    if (!u) {
      const err = new Error("User not found");
      err.statusCode = 400;
      throw err;
    }
    const pw = String(newPassword || "");
    if (pw.length < 6) {
      const err = new Error("Password must be at least 6 characters");
      err.statusCode = 400;
      throw err;
    }
    u.passwordHash = bcrypt.hashSync(pw, 12);
    u.mustChangePassword = true;
    u.updatedAt = nowIso();
    await this.save();
    return { id: u.id, username: u.username };
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
