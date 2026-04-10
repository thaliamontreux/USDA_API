const mysql = require("mysql2/promise");
const { config } = require("./config");
const { SqlHistory } = require("./sqlHistory");

const sqlHistory = new SqlHistory(config.sqlHistoryMax);

function buildPoolOptions() {
  const base = {
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  };

  if (config.db.connectMode === "socket") {
    return { ...base, socketPath: config.db.socketPath };
  }

  return { ...base, host: config.db.host, port: config.db.port };
}

const pool = mysql.createPool(buildPoolOptions());

async function query(sql, params) {
  const started = Date.now();
  try {
    const [rows] = await pool.execute(sql, params || []);
    const elapsedMs = Date.now() - started;
    sqlHistory.add({
      ts: new Date().toISOString(),
      elapsedMs,
      rowCount: Array.isArray(rows) ? rows.length : null,
      sql,
      params: params || null,
      error: null,
    });
    return { rows, meta: { elapsedMs } };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    sqlHistory.add({
      ts: new Date().toISOString(),
      elapsedMs,
      rowCount: null,
      sql,
      params: params || null,
      error: String(err && err.message ? err.message : err),
    });
    throw err;
  }
}

function getSqlHistory() {
  return sqlHistory.all();
}

function clearSqlHistory() {
  sqlHistory.clear();
}

module.exports = {
  pool,
  query,
  getSqlHistory,
  clearSqlHistory,
};
