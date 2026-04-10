const express = require("express");

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPage(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #0b1220; color: #e8eefc; }
    .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 18px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { opacity: 0.9; }
    label { display: block; margin: 12px 0 6px; }
    input { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(0,0,0,0.22); color: #e8eefc; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: #1b3a7a; color: white; cursor: pointer; }
    button.secondary { background: rgba(255,255,255,0.06); }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .row > * { flex: 1 1 auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.10); }
    .muted { opacity: 0.75; font-size: 12px; }
    .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); }
    .ok { color: #6ee7b7; }
    .bad { color: #fca5a5; }
    a { color: #93c5fd; }
    .danger { background: #7f1d1d; }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
</body>
</html>`;
}

function requireUserPasswordLogin(req, res, next) {
  if (req.session && req.session.adminUserId && req.session.adminPasswordOk) {
    next();
    return;
  }
  res.redirect("/account/login");
}

function accountRouter(opts) {
  const { keyStore, adminStore } = opts;
  const router = express.Router();

  async function getSessionUser(req) {
    const id = req.session ? req.session.adminUserId : null;
    if (!id) return null;
    return adminStore.getById(id);
  }

  async function requireUserReady(req, res, next) {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }

      if (String(user.role || "user") === "admin") {
        res.redirect("/admin");
        return;
      }

      if (user.mustChangePassword) {
        res.redirect("/account/change-password");
        return;
      }

      next();
    } catch (e) {
      next(e);
    }
  }

  router.get("/login", (req, res) => {
    const msg = req.query.msg ? String(req.query.msg) : "";
    const body = `
      <div class="card">
        <h1>USDA API Account</h1>
        <p class="muted">Login to manage your API keys.</p>
        ${msg ? `<p class="bad">${escapeHtml(msg)}</p>` : ""}
        <form method="post" action="/account/login">
          <label>Username</label>
          <input name="username" autocomplete="username" />
          <label>Password</label>
          <input name="password" type="password" autocomplete="current-password" />
          <div style="height: 14px"></div>
          <button type="submit">Login</button>
        </form>
      </div>
    `;
    res.type("html").send(renderPage("Account Login", body));
  });

  router.post("/login", async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const r = await adminStore.verifyPassword(username, password);
    if (!r.ok || !r.user) {
      res.redirect("/account/login?msg=Invalid%20credentials");
      return;
    }

    req.session.adminUserId = r.user.id;
    req.session.adminPasswordOk = true;
    req.session.adminMfaOk = false;
    req.session.userRole = String(r.user.role || "user");

    if (String(r.user.role || "user") === "admin") {
      res.redirect("/admin");
      return;
    }

    if (r.user.mustChangePassword) {
      res.redirect("/account/change-password");
      return;
    }

    res.redirect("/account");
  });

  router.get("/change-password", requireUserPasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }
      if (String(user.role || "user") === "admin") {
        res.redirect("/admin");
        return;
      }

      const msg = req.query.msg ? String(req.query.msg) : "";
      const body = `
        <div class="card">
          <h1>Change password</h1>
          <p class="bad"><strong>Password change required</strong> before continuing.</p>
          ${msg ? `<p class=\"bad\">${escapeHtml(msg)}</p>` : ""}
          <form method="post" action="/account/change-password">
            <label>Current password</label>
            <input name="current" type="password" autocomplete="current-password" />
            <label>New password</label>
            <input name="password" type="password" autocomplete="new-password" />
            <label>Confirm new password</label>
            <input name="confirm" type="password" autocomplete="new-password" />
            <div style="height: 14px"></div>
            <button type="submit">Update password</button>
          </form>
          <div style="height: 14px"></div>
          <form method="post" action="/account/logout">
            <button type="submit" class="secondary">Cancel</button>
          </form>
        </div>
      `;
      res.type("html").send(renderPage("Change password", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/change-password", requireUserPasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }
      if (String(user.role || "user") === "admin") {
        res.redirect("/admin");
        return;
      }

      const current = String(req.body.current || "");
      const password = String(req.body.password || "");
      const confirm = String(req.body.confirm || "");
      if (!password || password.length < 6) {
        res.redirect("/account/change-password?msg=Password%20must%20be%20at%20least%206%20characters");
        return;
      }
      if (password !== confirm) {
        res.redirect("/account/change-password?msg=Passwords%20do%20not%20match");
        return;
      }

      const r = await adminStore.verifyPassword(user.username, current);
      if (!r.ok) {
        res.redirect("/account/change-password?msg=Invalid%20current%20password");
        return;
      }

      await adminStore.setPassword(user.id, password, false);
      req.session.adminMfaOk = false;
      res.redirect("/account?notice=Password%20updated");
    } catch (e) {
      next(e);
    }
  });

  router.post("/logout", (req, res) => {
    if (req.session) {
      req.session.destroy(() => {
        res.redirect("/account/login");
      });
      return;
    }
    res.redirect("/account/login");
  });

  router.get("/", requireUserPasswordLogin, requireUserReady, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }

      const notice = req.query.notice ? String(req.query.notice) : "";
      const keys = await keyStore.list(user.username);
      const used = keys.length;
      const limit = Number.isFinite(Number(user.apiKeyLimit)) ? Number(user.apiKeyLimit) : 5;

      const rows = keys
        .map((k) => {
          const enabled = k.enabled ? '<span class="pill ok">enabled</span>' : '<span class="pill bad">disabled</span>';
          return `
            <tr>
              <td>${escapeHtml(k.id)}</td>
              <td>${enabled}</td>
              <td class="muted">****${escapeHtml(k.last4 || "")}</td>
              <td class="muted">${escapeHtml(k.rotatedAt || "")}</td>
              <td>
                <form method="post" action="/account/keys/${encodeURIComponent(k.id)}/rotate" style="display:inline">
                  <button type="submit">Rotate</button>
                </form>
                <form method="post" action="/account/keys/${encodeURIComponent(k.id)}/${k.enabled ? "disable" : "enable"}" style="display:inline">
                  <button type="submit" class="secondary">${k.enabled ? "Disable" : "Enable"}</button>
                </form>
                <form method="post" action="/account/keys/${encodeURIComponent(k.id)}/revoke" style="display:inline">
                  <button type="submit" class="danger">Revoke</button>
                </form>
              </td>
            </tr>
          `;
        })
        .join("");

      const canCreate = used < limit;

      const body = `
        <div class="row" style="margin-bottom: 12px;">
          <div>
            <h1>Account control panel</h1>
            <div class="muted">User: ${escapeHtml(user.username)} • Keys: ${used}/${limit}</div>
          </div>
          <div style="text-align:right;">
            <form method="post" action="/account/logout">
              <button type="submit" class="secondary">Logout</button>
            </form>
          </div>
        </div>

        ${notice ? `<div class=\"card\" style=\"margin-bottom:12px;\"><div>${escapeHtml(notice)}</div></div>` : ""}

        <div class="card">
          <h1>API Keys</h1>
          <p class="muted">Keys are stored hashed; only the last 4 characters are shown. When you create/rotate a key, the new key is displayed once.</p>
          <div class="row" style="margin-bottom: 12px;">
            <div class="muted">Key limit default is 5 unless an admin raises it.</div>
            <div style="text-align:right;">
              <form method="post" action="/account/keys/create" style="display:inline">
                <button type="submit" ${canCreate ? "" : "disabled"}>Create new key</button>
              </form>
            </div>
          </div>
          ${canCreate ? "" : `<div class=\"bad\">Key limit reached. Ask an admin to raise your limit.</div>`}
          <table>
            <thead>
              <tr><th>Id</th><th>Status</th><th>Masked</th><th>Rotated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" class="muted">No keys yet</td></tr>'}
            </tbody>
          </table>
        </div>

        <div style="height: 14px"></div>

        <div class="card">
          <h1>Using the API</h1>
          <div class="muted">Send either header:</div>
          <div class="muted"><code>x-api-key: &lt;key&gt;</code></div>
          <div class="muted"><code>Authorization: Bearer &lt;key&gt;</code></div>
        </div>
      `;

      res.type("html").send(renderPage("Account", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/create", requireUserPasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }
      if (String(user.role || "user") === "admin") {
        res.redirect("/admin");
        return;
      }

      if (user.mustChangePassword) {
        res.redirect("/account/change-password");
        return;
      }

      const limit = Number.isFinite(Number(user.apiKeyLimit)) ? Number(user.apiKeyLimit) : 5;
      const used = await keyStore.count(user.username);
      if (used >= limit) {
        res.redirect("/account?notice=Key%20limit%20reached");
        return;
      }

      const r = await keyStore.create(user.username);
      res.type("html").send(
        renderPage(
          "Key Created",
          `
          <div class="card">
            <h1>New key created</h1>
            <p class="bad"><strong>Copy this key now</strong>. You will not be able to view it again.</p>
            <div class="card" style="margin-top:12px;">
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(
                r.key
              )}</div>
            </div>
            <div style="height: 14px"></div>
            <a href="/account?notice=Key%20created">Back</a>
          </div>
          `
        )
      );
    } catch (e) {
      next(e);
    }
  });

  async function requireOwnKey(req, res, next) {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/account/login");
        return;
      }
      if (String(user.role || "user") === "admin") {
        res.redirect("/admin");
        return;
      }

      const id = String(req.params.id || "");
      const k = await keyStore.getById(id);
      if (!k || String(k.ownerUsername || "") !== String(user.username)) {
        res.redirect("/account?notice=Unknown%20key");
        return;
      }

      req._accountKey = k;
      next();
    } catch (e) {
      next(e);
    }
  }

  router.post("/keys/:id/rotate", requireUserPasswordLogin, requireOwnKey, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      const r = await keyStore.rotate(id);
      res.type("html").send(
        renderPage(
          "Key Rotated",
          `
          <div class="card">
            <h1>Key rotated</h1>
            <p class="bad"><strong>Copy this key now</strong>. You will not be able to view it again.</p>
            <div class="card" style="margin-top:12px;">
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(
                r.key
              )}</div>
            </div>
            <div style="height: 14px"></div>
            <a href="/account?notice=Key%20rotated">Back</a>
          </div>
          `
        )
      );
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/enable", requireUserPasswordLogin, requireOwnKey, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.setEnabled(id, true);
      res.redirect("/account?notice=Key%20enabled");
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/disable", requireUserPasswordLogin, requireOwnKey, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.setEnabled(id, false);
      res.redirect("/account?notice=Key%20disabled");
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/revoke", requireUserPasswordLogin, requireOwnKey, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.revoke(id);
      res.redirect("/account?notice=Key%20revoked");
    } catch (e) {
      next(e);
    }
  });

  return router;
}

module.exports = { accountRouter };
