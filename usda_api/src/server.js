const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const session = require("express-session");
const { config } = require("./config");
const { query } = require("./db");
const { foodsRouter } = require("./routes/foods");
const { nutrientsRouter } = require("./routes/nutrients");
const { brandedRouter } = require("./routes/branded");
const { debugRouter } = require("./routes/debug");
const { adminRouter } = require("./routes/admin");
const { accountRouter } = require("./routes/account");
const { KeyStore } = require("./auth/keyStore");
const { apiKeyMiddleware } = require("./auth/apiKeyAuth");
const { AdminStore } = require("./auth/adminStore");

const app = express();

app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

const keyStore = new KeyStore(config.auth.keyStorePath);
const adminStore = new AdminStore(config.auth.adminStorePath);

adminStore.load().catch((e) => {
  process.stderr.write(
    `AdminStore load failed: ${String(e && e.message ? e.message : e)}\n`
  );
});
keyStore
  .load()
  .then((s) => {
    if (s && s.bootstrapKeys) {
      process.stdout.write("\n*** USDA API bootstrap keys (copy now) ***\n");
      process.stdout.write(`key1: ${s.bootstrapKeys.key1}\n`);
      process.stdout.write(`key2: ${s.bootstrapKeys.key2}\n`);
      process.stdout.write("***************************************\n\n");
    }
  })
  .catch((e) => {
    process.stderr.write(`KeyStore load failed: ${String(e && e.message ? e.message : e)}\n`);
  });

const sessionSecret = config.auth.sessionSecret || "";
if (!sessionSecret) {
  process.stderr.write(
    "WARNING: SESSION_SECRET is not set. Admin sessions will reset on restart.\n"
  );
}

app.use(
  session({
    name: "usda_api_admin",
    secret: sessionSecret || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.auth.sessionCookieSecure,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use(
  "/admin",
  adminRouter({
    keyStore,
    adminStore,
    rpID: config.auth.webauthnRpId,
    origin: config.auth.webauthnOrigin,
    rpName: config.auth.webauthnRpName,
  })
);

app.use(
  "/account",
  accountRouter({
    keyStore,
    adminStore,
  })
);

app.get("/health", async (req, res) => {
  try {
    const { rows } = await query("SELECT 1 AS ok", []);
    res.json({ ok: true, db: rows && rows[0] ? rows[0].ok === 1 : true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.get("/healthz", async (req, res) => {
  try {
    const { rows } = await query("SELECT 1 AS ok", []);
    res.json({
      ok: true,
      module: "usdafooddb",
      service: "usda-api",
      version: "0.1.0",
      db: rows && rows[0] ? rows[0].ok === 1 : true,
    });
  } catch (e) {
    res.status(503).json({
      ok: false,
      module: "usdafooddb",
      service: "usda-api",
      version: "0.1.0",
      error: String(e && e.message ? e.message : e),
    });
  }
});

app.get("/", (req, res) => {
  res.json({
    name: "usda-api",
    version: "0.1.0",
    endpoints: [
      "/health",
      "/healthz",
      "/admin",
      "/account",
      "/api/v1/foods/search",
      "/api/v1/foods/:fdcId",
      "/api/v1/foods/:fdcId/nutrients",
      "/api/v1/nutrients/search",
      "/api/v1/branded/search",
      "/api/v1/branded/:fdcId",
      "/api/v1/debug/sql-history",
    ],
  });
});

const requireApiKey = apiKeyMiddleware(keyStore);

app.use("/api/v1/foods", requireApiKey, foodsRouter);
app.use("/api/v1/nutrients", requireApiKey, nutrientsRouter);
app.use("/api/v1/branded", requireApiKey, brandedRouter);
app.use("/api/v1/debug", requireApiKey, debugRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  const status = err && err.statusCode ? err.statusCode : 500;
  const message = String(err && err.message ? err.message : err);
  process.stderr.write(
    `[error] ${req.method} ${req.originalUrl || req.url || ""} -> ${status}: ${message}\n`
  );
  if (err && err.stack) process.stderr.write(`${err.stack}\n`);

  const payload = { error: message };
  if (err && err.code) payload.code = String(err.code);
  if (err && err.errno !== undefined) payload.errno = err.errno;
  if (err && err.sqlState) payload.sqlState = String(err.sqlState);
  res.status(status).json(payload);
});

app.listen(config.port, config.bindHost, () => {
  process.stdout.write(
    `Listening on ${config.bindHost}:${config.port}\n`
  );
});
