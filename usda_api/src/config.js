const dotenv = require("dotenv");

dotenv.config();

function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

function envInt(name, fallback) {
  const v = env(name, "");
  if (v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: envInt("PORT", 8080),
  bindHost: env("BIND_HOST", "127.0.0.1"),
  db: {
    name: env("DB_NAME", "usdafooddb"),
    user: env("DB_USER", "foodie"),
    password: env("DB_PASSWORD", ""),
    host: env("DB_HOST", "127.0.0.1"),
    port: envInt("DB_PORT", 3306),
    socketPath: env("DB_SOCKET_PATH", "/var/run/mysqld/mysqld.sock"),
    connectMode: env("DB_CONNECT_MODE", "socket"),
  },
  sqlHistoryMax: envInt("SQL_HISTORY_MAX", 200),
  auth: {
    keyStorePath: env("KEYSTORE_PATH", "./data/keys.json"),
    adminStorePath: env("ADMIN_STORE_PATH", "./data/admin_users.json"),
    sessionSecret: env("SESSION_SECRET", ""),
    sessionCookieSecure: env("SESSION_COOKIE_SECURE", "0") === "1",
    webauthnRpId: env("RP_ID", "localhost"),
    webauthnOrigin: env("ORIGIN", "http://localhost:8080"),
    webauthnRpName: env("RP_NAME", "USDA API"),
  },
};

module.exports = { config };
