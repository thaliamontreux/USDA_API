const express = require("express");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const {
  toBase64UrlFromBuffer,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
} = require("../auth/webauthnUtil");

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requirePasswordLogin(req, res, next) {
  if (req.session && req.session.adminUserId && req.session.adminPasswordOk) {
    const role = String(req.session.userRole || "");
    if (role && role !== "admin") {
      res.redirect("/account");
      return;
    }
    next();
    return;
  }
  res.redirect("/admin/login");
}

function requireMfa(req, res, next) {
  if (req.session && req.session.adminMfaOk) {
    next();
    return;
  }
  res.redirect("/admin/mfa");
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

function adminRouter(opts) {
  const {
    keyStore,
    adminStore,
    rpID,
    origin,
    rpName,
  } = opts;

  const router = express.Router();

  async function getSessionUser(req) {
    const id = req.session ? req.session.adminUserId : null;
    if (!id) return null;
    return adminStore.getById(id);
  }

  async function requireAdminReady(req, res, next) {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

       if (String(user.role || "user") !== "admin") {
         res.redirect("/account");
         return;
       }

      if (user.mustChangePassword) {
        res.redirect("/admin/change-password");
        return;
      }

      const mfa = await adminStore.listMfa(user.id);
      const mfaConfigured = Boolean(mfa.totpEnabled) || mfa.passkeys > 0;
      if (!mfaConfigured) {
        res.redirect("/admin/setup-mfa");
        return;
      }

      if (!req.session.adminMfaOk) {
        res.redirect("/admin/mfa");
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
        <h1>USDA API Admin</h1>
        <p class="muted">Login to manage API keys (two-key rotation).</p>
        ${msg ? `<p class="bad">${escapeHtml(msg)}</p>` : ""}
        <form method="post" action="/admin/login">
          <label>Username</label>
          <input name="username" autocomplete="username" />
          <label>Password</label>
          <input name="password" type="password" autocomplete="current-password" />
          <div style="height: 14px"></div>
          <button type="submit">Login</button>
        </form>
      </div>
    `;
    res.type("html").send(renderPage("Admin Login", body));
  });

  router.post("/login", async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const r = await adminStore.verifyPassword(username, password);
    if (!r.ok || !r.user) {
      res.redirect("/admin/login?msg=Invalid%20credentials");
      return;
    }

    req.session.adminUserId = r.user.id;
    req.session.adminPasswordOk = true;
    req.session.adminMfaOk = false;
    req.session.userRole = String(r.user.role || "user");

     if (String(r.user.role || "user") !== "admin") {
       res.redirect("/account");
       return;
     }

    if (r.user.mustChangePassword) {
      res.redirect("/admin/change-password");
      return;
    }

    const mfa = await adminStore.listMfa(r.user.id);
    const mfaConfigured = Boolean(mfa.totpEnabled) || mfa.passkeys > 0;
    if (!mfaConfigured) {
      res.redirect("/admin/setup-mfa");
      return;
    }

    res.redirect("/admin/mfa");
  });

  router.post("/logout", (req, res) => {
    if (req.session) {
      req.session.destroy(() => {
        res.redirect("/admin/login");
      });
      return;
    }
    res.redirect("/admin/login");
  });

  router.get("/change-password", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      const msg = req.query.msg ? String(req.query.msg) : "";

      const body = `
        <div class="card">
          <h1>Change password</h1>
          <p class="bad"><strong>Password change required</strong> before continuing.</p>
          ${msg ? `<p class="bad">${escapeHtml(msg)}</p>` : ""}
          <form method="post" action="/admin/change-password">
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
          <form method="post" action="/admin/logout">
            <button type="submit" class="secondary">Cancel</button>
          </form>
        </div>
      `;
      res.type("html").send(renderPage("Change password", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/change-password", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      const current = String(req.body.current || "");
      const password = String(req.body.password || "");
      const confirm = String(req.body.confirm || "");

      const ok = await bcrypt.compare(current, user.passwordHash);
      if (!ok) {
        res.redirect("/admin/change-password?msg=Current%20password%20incorrect");
        return;
      }

      if (password.length < 10) {
        res.redirect("/admin/change-password?msg=Password%20too%20short");
        return;
      }

      if (password !== confirm) {
        res.redirect("/admin/change-password?msg=Passwords%20do%20not%20match");
        return;
      }

      await adminStore.setPassword(user.id, password, false);
      req.session.adminMfaOk = false;
      res.redirect("/admin/setup-mfa?notice=Password%20updated");
    } catch (e) {
      next(e);
    }
  });

  router.get("/setup-mfa", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      if (user.mustChangePassword) {
        res.redirect("/admin/change-password");
        return;
      }

      const mfa = await adminStore.listMfa(user.id);
      const configured = Boolean(mfa.totpEnabled) || mfa.passkeys > 0;
      const notice = req.query.notice ? String(req.query.notice) : "";

      const body = `
        <div class="card">
          <h1>Set up MFA</h1>
          <p class="muted">You must configure at least one second factor before continuing.</p>
          ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ""}

          <div class="card" style="margin-top:12px;">
            <h1>TOTP (Authenticator app)</h1>
            <div class="muted">Status: ${mfa.totpEnabled ? "<span class=\"pill ok\">enabled</span>" : "<span class=\"pill bad\">not enabled</span>"}</div>
            <div style="height:10px"></div>
            <form method="post" action="/admin/totp/start">
              <button type="submit">Start / Reset TOTP</button>
            </form>
          </div>

          <div class="card" style="margin-top:12px;">
            <h1>Passkeys / Security Keys</h1>
            <div class="muted">Registered passkeys: ${mfa.passkeys}</div>
            <div style="height:10px"></div>
            <a href="/admin/passkeys">Manage passkeys</a>
          </div>

          <div style="height:14px"></div>
          ${configured ? `<a href=\"/admin/mfa\">Continue</a>` : ""}
        </div>
      `;

      res.type("html").send(renderPage("Setup MFA", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/totp/start", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      if (user.mustChangePassword) {
        res.redirect("/admin/change-password");
        return;
      }

      const secret = speakeasy.generateSecret({
        name: `USDA API (${user.username})`,
        length: 32,
      });

      await adminStore.setTotpSecret(user.id, secret.base32);
      req.session.pendingTotpSecret = secret.base32;

      const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

      const body = `
        <div class="card">
          <h1>TOTP setup</h1>
          <p class="muted">Scan this QR code with your authenticator app.</p>
          <div style="height:12px"></div>
          <img src="${qrDataUrl}" alt="TOTP QR" style="max-width:320px; width:100%; border-radius:12px;" />
          <div style="height:12px"></div>
          <div class="muted">If you can’t scan, use this secret:</div>
          <div class="card" style="margin-top:8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(secret.base32)}</div>
          <div style="height:12px"></div>

          <form method="post" action="/admin/totp/verify">
            <label>Enter 6-digit code</label>
            <input name="code" inputmode="numeric" autocomplete="one-time-code" />
            <div style="height: 14px"></div>
            <button type="submit">Verify & Enable</button>
          </form>
          <div style="height: 14px"></div>
          <a href="/admin/setup-mfa">Back</a>
        </div>
      `;

      res.type("html").send(renderPage("TOTP setup", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/totp/verify", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      const code = String(req.body.code || "").trim().replaceAll(" ", "");
      const secret = String(req.session.pendingTotpSecret || user.totp.secretBase32 || "");
      if (!secret) {
        res.redirect("/admin/setup-mfa?notice=No%20TOTP%20secret%20set");
        return;
      }

      const ok = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: code,
        window: 2,
      });

      if (!ok) {
        res.redirect("/admin/setup-mfa?notice=Invalid%20TOTP%20code");
        return;
      }

      await adminStore.enableTotp(user.id, true);
      req.session.pendingTotpSecret = "";
      res.redirect("/admin/setup-mfa?notice=TOTP%20enabled");
    } catch (e) {
      next(e);
    }
  });

  router.get("/passkeys", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      const notice = req.query.notice ? String(req.query.notice) : "";
      const mfa = await adminStore.listMfa(user.id);

      const body = `
        <div class="card">
          <h1>Passkeys / Security Keys</h1>
          <p class="muted">Register a passkey or a security key.</p>
          ${notice ? `<p class=\"ok\">${escapeHtml(notice)}</p>` : ""}

          <div class="card" style="margin-top:12px;">
            <div class="muted">Registered passkeys: ${mfa.passkeys}</div>
            <div style="height:10px"></div>
            <button id="btnRegister" type="button">Register passkey</button>
            <div style="height:10px"></div>
            <div id="status" class="muted"></div>
          </div>

          <div style="height: 14px"></div>
          <a href="/admin/setup-mfa">Back</a>
        </div>

        <script>
          const statusEl = document.getElementById('status');
          function setStatus(msg, kind){
            if (!statusEl) return;
            statusEl.textContent = msg || '';
            statusEl.className = kind === 'bad' ? 'bad' : (kind === 'ok' ? 'ok' : 'muted');
          }

          async function b64urlToBuf(b64url){
            const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
            const base64 = (b64url + pad).replace(/-/g,'+').replace(/_/g,'/');
            const raw = atob(base64);
            const buf = new Uint8Array(raw.length);
            for (let i=0;i<raw.length;i++) buf[i] = raw.charCodeAt(i);
            return buf.buffer;
          }
          function bufToB64url(buf){
            const bytes = new Uint8Array(buf);
            let s='';
            for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
            const base64 = btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            return base64;
          }

          async function readJsonResponse(r){
            const ct = (r.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('application/json')) return r.json();
            const t = await r.text();
            throw new Error('Expected JSON response but got: ' + (t ? t.slice(0, 200) : '(empty)'));
          }

          async function register(){
            if (!window.isSecureContext) {
              throw new Error('WebAuthn requires HTTPS (or http://localhost).');
            }
            if (!navigator.credentials || !navigator.credentials.create) {
              throw new Error('WebAuthn not supported in this browser.');
            }

            setStatus('Requesting registration options…');
            const r1 = await fetch('/admin/webauthn/register/options', { credentials: 'same-origin' });
            if (!r1.ok) {
              throw new Error('Failed to get registration options (HTTP ' + r1.status + ').');
            }
            const opts = await readJsonResponse(r1);
            if (!opts || !opts.challenge || !opts.user || !opts.user.id) {
              throw new Error('Invalid registration options returned by server.');
            }

            opts.challenge = await b64urlToBuf(opts.challenge);
            opts.user.id = await b64urlToBuf(opts.user.id);
            if (opts.excludeCredentials){
              for (const c of opts.excludeCredentials){
                c.id = await b64urlToBuf(c.id);
              }
            }

            setStatus('Waiting for browser passkey prompt…');
            const cred = await navigator.credentials.create({ publicKey: opts });
            if (!cred) throw new Error('Passkey registration was cancelled.');
            const response = {
              id: cred.id,
              rawId: bufToB64url(cred.rawId),
              type: cred.type,
              response: {
                attestationObject: bufToB64url(cred.response.attestationObject),
                clientDataJSON: bufToB64url(cred.response.clientDataJSON),
              },
              clientExtensionResults: cred.getClientExtensionResults(),
              transports: cred.response.getTransports ? cred.response.getTransports() : [],
            };

            setStatus('Verifying passkey with server…');
            const r2 = await fetch('/admin/webauthn/register/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(response),
              credentials: 'same-origin',
            });
            if (!r2.ok) {
              const t = await r2.text();
              throw new Error('Server rejected registration (HTTP ' + r2.status + '): ' + (t ? t.slice(0, 200) : '(empty)'));
            }
            const out = await readJsonResponse(r2);
            if (!out.ok) throw new Error(out.error || 'Registration failed');
            setStatus('Passkey registered.', 'ok');
            window.location.href = '/admin/passkeys?notice=Passkey%20registered';
          }

          document.getElementById('btnRegister').addEventListener('click', () => {
            const btn = document.getElementById('btnRegister');
            if (btn) btn.disabled = true;
            setStatus('Starting passkey registration…');
            register().catch(e => {
              setStatus(String(e && e.message ? e.message : e), 'bad');
            }).finally(() => {
              if (btn) btn.disabled = false;
            });
          });
        </script>
      `;

      res.type("html").send(renderPage("Passkeys", body));
    } catch (e) {
      next(e);
    }
  });

  router.get("/webauthn/register/options", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const opts = await registrationOptions({ rpID, rpName, origin, user });
      req.session.webauthnRegChallenge = opts.challenge;
      res.json(opts);
    } catch (e) {
      next(e);
    }
  });

  router.post("/webauthn/register/verify", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }

      const expectedChallenge = req.session.webauthnRegChallenge;
      if (!expectedChallenge) {
        res.status(400).json({ ok: false, error: "Missing challenge" });
        return;
      }

      const verification = await verifyRegistration({
        rpID,
        origin,
        expectedChallenge,
        response: req.body,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ ok: false, error: "Registration not verified" });
        return;
      }

      const info = verification.registrationInfo;
      await adminStore.addWebAuthnCredential(user.id, {
        id: toBase64UrlFromBuffer(info.credentialID),
        publicKey: Buffer.from(info.credentialPublicKey).toString("base64"),
        counter: info.counter,
        transports: Array.isArray(req.body.transports) ? req.body.transports : [],
      });

      req.session.webauthnRegChallenge = "";
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get("/mfa", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      if (user.mustChangePassword) {
        res.redirect("/admin/change-password");
        return;
      }

      const mfa = await adminStore.listMfa(user.id);
      const configured = Boolean(mfa.totpEnabled) || mfa.passkeys > 0;
      if (!configured) {
        res.redirect("/admin/setup-mfa");
        return;
      }

      const msg = req.query.msg ? String(req.query.msg) : "";

      const body = `
        <div class="card">
          <h1>Second factor required</h1>
          ${msg ? `<p class="bad">${escapeHtml(msg)}</p>` : ""}

          ${mfa.totpEnabled ? `
            <div class="card" style="margin-top:12px;">
              <h1>TOTP code</h1>
              <form method="post" action="/admin/mfa/totp">
                <label>6-digit code</label>
                <input name="code" inputmode="numeric" autocomplete="one-time-code" />
                <div style="height: 14px"></div>
                <button type="submit">Verify</button>
              </form>
            </div>
          ` : ""}

          ${mfa.passkeys > 0 ? `
            <div class="card" style="margin-top:12px;">
              <h1>Passkey / Security key</h1>
              <button id="btnPasskey" type="button">Use passkey</button>
            </div>
          ` : ""}

          <div style="height: 14px"></div>
          <form method="post" action="/admin/logout">
            <button type="submit" class="secondary">Cancel</button>
          </form>
        </div>

        <script>
          async function b64urlToBuf(b64url){
            const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
            const base64 = (b64url + pad).replace(/-/g,'+').replace(/_/g,'/');
            const raw = atob(base64);
            const buf = new Uint8Array(raw.length);
            for (let i=0;i<raw.length;i++) buf[i] = raw.charCodeAt(i);
            return buf.buffer;
          }
          function bufToB64url(buf){
            const bytes = new Uint8Array(buf);
            let s='';
            for (let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
            const base64 = btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            return base64;
          }

          async function passkeyAuth(){
            const r1 = await fetch('/admin/webauthn/auth/options');
            const opts = await r1.json();
            opts.challenge = await b64urlToBuf(opts.challenge);
            if (opts.allowCredentials){
              for (const c of opts.allowCredentials){
                c.id = await b64urlToBuf(c.id);
              }
            }
            const a = await navigator.credentials.get({ publicKey: opts });
            const response = {
              id: a.id,
              rawId: bufToB64url(a.rawId),
              type: a.type,
              response: {
                authenticatorData: bufToB64url(a.response.authenticatorData),
                clientDataJSON: bufToB64url(a.response.clientDataJSON),
                signature: bufToB64url(a.response.signature),
                userHandle: a.response.userHandle ? bufToB64url(a.response.userHandle) : null,
              },
              clientExtensionResults: a.getClientExtensionResults(),
            };
            const r2 = await fetch('/admin/webauthn/auth/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(response)
            });
            const out = await r2.json();
            if (!out.ok) throw new Error(out.error || 'Auth failed');
            window.location.href = '/admin';
          }

          const btn = document.getElementById('btnPasskey');
          if (btn) {
            btn.addEventListener('click', () => {
              passkeyAuth().catch(e => alert(String(e && e.message ? e.message : e)));
            });
          }
        </script>
      `;

      res.type("html").send(renderPage("MFA", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/mfa/totp", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.redirect("/admin/login");
        return;
      }

      const mfa = await adminStore.listMfa(user.id);
      if (!mfa.totpEnabled) {
        res.redirect("/admin/mfa?msg=TOTP%20not%20enabled");
        return;
      }

      const code = String(req.body.code || "").trim().replaceAll(" ", "");
      const ok = speakeasy.totp.verify({
        secret: user.totp.secretBase32,
        encoding: "base32",
        token: code,
        window: 2,
      });

      if (!ok) {
        res.redirect("/admin/mfa?msg=Invalid%20code");
        return;
      }

      req.session.adminMfaOk = true;
      res.redirect("/admin");
    } catch (e) {
      next(e);
    }
  });

  router.get("/webauthn/auth/options", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const opts = await authenticationOptions({ rpID, user });
      req.session.webauthnAuthChallenge = opts.challenge;
      res.json(opts);
    } catch (e) {
      next(e);
    }
  });

  router.post("/webauthn/auth/verify", requirePasswordLogin, async (req, res, next) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }

      const expectedChallenge = req.session.webauthnAuthChallenge;
      if (!expectedChallenge) {
        res.status(400).json({ ok: false, error: "Missing challenge" });
        return;
      }

      const credentialId = String(req.body.id || "");
      const credential = (user.webauthn.credentials || []).find((c) => c.id === credentialId);
      if (!credential) {
        res.status(400).json({ ok: false, error: "Unknown credential" });
        return;
      }

      const verification = await verifyAuthentication({
        rpID,
        origin,
        expectedChallenge,
        response: req.body,
        credential,
      });

      if (!verification.verified || !verification.authenticationInfo) {
        res.status(400).json({ ok: false, error: "Authentication not verified" });
        return;
      }

      await adminStore.updateWebAuthnCounter(
        user.id,
        credentialId,
        verification.authenticationInfo.newCounter
      );

      req.session.webauthnAuthChallenge = "";
      req.session.adminMfaOk = true;
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.get("/", requireAdminReady, async (req, res, next) => {
    try {
      const keys = await keyStore.list();
      const notice = req.query.notice ? String(req.query.notice) : "";

      const rows = keys
        .map((k) => {
          const enabled = k.enabled ? "<span class=\"pill ok\">enabled</span>" : "<span class=\"pill bad\">disabled</span>";
          return `
            <tr>
              <td>${escapeHtml(k.ownerUsername || "")}</td>
              <td>${escapeHtml(k.id)}</td>
              <td>${enabled}</td>
              <td class="muted">****${escapeHtml(k.last4 || "")}</td>
              <td class="muted">${escapeHtml(k.rotatedAt || "")}</td>
              <td>
                <form method="post" action="/admin/keys/${encodeURIComponent(k.id)}/rotate" style="display:inline">
                  <button type="submit">Rotate</button>
                </form>
                <form method="post" action="/admin/keys/${encodeURIComponent(k.id)}/${k.enabled ? "disable" : "enable"}" style="display:inline">
                  <button type="submit" class="secondary">${k.enabled ? "Disable" : "Enable"}</button>
                </form>
                <form method="post" action="/admin/keys/${encodeURIComponent(k.id)}/revoke" style="display:inline">
                  <button type="submit" class="danger">Revoke</button>
                </form>
              </td>
            </tr>
          `;
        })
        .join("");

      const body = `
        <div class="row" style="margin-bottom: 12px;">
          <div><h1>USDA API Admin</h1><div class="muted">Manage users and API keys.</div></div>
          <div style="text-align:right;">
            <form method="post" action="/admin/logout">
              <button type="submit" class="secondary">Logout</button>
            </form>
          </div>
        </div>

        <div class="card" style="margin-bottom:12px;">
          <div class="row">
            <div>
              <div><a href="/admin/users">Users</a></div>
              <div class="muted">Create users and set per-user key limits (default 5; admin unlimited).</div>
            </div>
            <div style="text-align:right;">
              <form method="post" action="/admin/keys/create" style="display:inline">
                <button type="submit">Create admin key</button>
              </form>
            </div>
          </div>
        </div>

        ${notice ? `<div class=\"card\" style=\"margin-bottom:12px;\"><div>${escapeHtml(notice)}</div></div>` : ""}

        <div class="card">
          <h1>API Keys</h1>
          <p class="muted">Keys are stored hashed; only the last 4 characters are shown. When you rotate a key, the new key is displayed once.</p>
          <table>
            <thead>
              <tr><th>User</th><th>Id</th><th>Status</th><th>Masked</th><th>Rotated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rows}
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

      res.type("html").send(renderPage("Admin", body));
    } catch (e) {
      next(e);
    }
  });

  router.get("/users", requireAdminReady, async (req, res, next) => {
    try {
      const notice = req.query.notice ? String(req.query.notice) : "";
      const users = await adminStore.listUsers();
      const withCounts = await Promise.all(
        users.map(async (u) => ({
          ...u,
          keyCount: await keyStore.count(u.username),
        }))
      );

      const rows = withCounts
        .map((u) => {
          const role = String(u.role || "user");
          const isAdmin = role === "admin";
          const limitLabel = isAdmin ? "∞" : String(u.apiKeyLimit);
          return `
            <tr>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(role)}</td>
              <td class="muted">${escapeHtml(String(u.keyCount))}/${escapeHtml(limitLabel)}</td>
              <td class="muted">${escapeHtml(u.updatedAt || "")}</td>
              <td>
                <form method="post" action="/admin/users/${encodeURIComponent(u.id)}/limit" style="display:inline">
                  <input name="limit" value="${escapeHtml(String(u.apiKeyLimit))}" style="max-width:120px; display:inline" />
                  <button type="submit" class="secondary">Set limit</button>
                </form>
                <form method="post" action="/admin/users/${encodeURIComponent(u.id)}/role" style="display:inline">
                  <input name="role" value="${escapeHtml(role)}" style="max-width:120px; display:inline" />
                  <button type="submit" class="secondary">Set role</button>
                </form>
                <form method="post" action="/admin/users/${encodeURIComponent(u.id)}/reset-password" style="display:inline">
                  <input name="password" placeholder="New password" style="max-width:180px; display:inline" />
                  <button type="submit" class="secondary">Reset password</button>
                </form>
                <form method="post" action="/admin/users/${encodeURIComponent(u.id)}/keys/create" style="display:inline">
                  <button type="submit">Create key</button>
                </form>
              </td>
            </tr>
          `;
        })
        .join("");

      const body = `
        <div class="row" style="margin-bottom: 12px;">
          <div><h1>Users</h1><div class="muted">Default limit is 5 keys per user. Admins have unlimited keys.</div></div>
          <div style="text-align:right;"><a href="/admin">Back</a></div>
        </div>

        ${notice ? `<div class=\"card\" style=\"margin-bottom:12px;\"><div>${escapeHtml(notice)}</div></div>` : ""}

        <div class="card" style="margin-bottom:12px;">
          <h1>Create user</h1>
          <form method="post" action="/admin/users/create">
            <label>Username</label>
            <input name="username" autocomplete="username" />
            <label>Temporary password</label>
            <input name="password" type="password" autocomplete="new-password" />
            <label>Role (user/admin)</label>
            <input name="role" value="user" />
            <label>Key limit (default 5)</label>
            <input name="limit" value="5" />
            <div style="height: 14px"></div>
            <button type="submit">Create</button>
          </form>
        </div>

        <div class="card">
          <h1>Existing users</h1>
          <table>
            <thead>
              <tr><th>Username</th><th>Role</th><th>Keys</th><th>Updated</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;

      res.type("html").send(renderPage("Users", body));
    } catch (e) {
      next(e);
    }
  });

  router.post("/users/create", requireAdminReady, async (req, res, next) => {
    try {
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");
      const role = String(req.body.role || "user").trim();
      const limit = String(req.body.limit || "").trim();
      await adminStore.createUser({ username, password, role, apiKeyLimit: limit });
      res.redirect("/admin/users?notice=User%20created");
    } catch (e) {
      res.redirect(`/admin/users?notice=${encodeURIComponent(String(e && e.message ? e.message : e))}`);
    }
  });

  router.post("/users/:id/limit", requireAdminReady, async (req, res) => {
    const id = String(req.params.id || "");
    const limit = String(req.body.limit || "").trim();
    try {
      await adminStore.setApiKeyLimit(id, limit);
      res.redirect("/admin/users?notice=Limit%20updated");
    } catch (e) {
      res.redirect(`/admin/users?notice=${encodeURIComponent(String(e && e.message ? e.message : e))}`);
    }
  });

  router.post("/users/:id/role", requireAdminReady, async (req, res) => {
    const id = String(req.params.id || "");
    const role = String(req.body.role || "user").trim();
    try {
      await adminStore.setRole(id, role);
      res.redirect("/admin/users?notice=Role%20updated");
    } catch (e) {
      res.redirect(`/admin/users?notice=${encodeURIComponent(String(e && e.message ? e.message : e))}`);
    }
  });

  router.post("/users/:id/reset-password", requireAdminReady, async (req, res) => {
    const id = String(req.params.id || "");
    const password = String(req.body.password || "");
    try {
      await adminStore.resetPassword(id, password);
      res.redirect("/admin/users?notice=Password%20reset");
    } catch (e) {
      res.redirect(`/admin/users?notice=${encodeURIComponent(String(e && e.message ? e.message : e))}`);
    }
  });

  router.post("/users/:id/keys/create", requireAdminReady, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      const user = await adminStore.getById(id);
      if (!user) {
        res.redirect("/admin/users?notice=User%20not%20found");
        return;
      }

      const role = String(user.role || "user");
      if (role !== "admin") {
        const limit = Number.isFinite(Number(user.apiKeyLimit)) ? Number(user.apiKeyLimit) : 5;
        const used = await keyStore.count(user.username);
        if (used >= limit) {
          res.redirect("/admin/users?notice=Key%20limit%20reached");
          return;
        }
      }

      const r = await keyStore.create(user.username);
      res.type("html").send(
        renderPage(
          "Key Created",
          `
          <div class="card">
            <h1>New key created for ${escapeHtml(r.ownerUsername)}</h1>
            <p class="bad"><strong>Copy this key now</strong>. You will not be able to view it again.</p>
            <div class="card" style="margin-top:12px;">
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(
                r.key
              )}</div>
            </div>
            <div style="height: 14px"></div>
            <a href="/admin/users?notice=Key%20created">Back</a>
          </div>
          `
        )
      );
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/create", requireAdminReady, async (req, res, next) => {
    try {
      const r = await keyStore.create("admin");
      res.type("html").send(
        renderPage(
          "Key Created",
          `
          <div class="card">
            <h1>New admin key created</h1>
            <p class="bad"><strong>Copy this key now</strong>. You will not be able to view it again.</p>
            <div class="card" style="margin-top:12px;">
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(
                r.key
              )}</div>
            </div>
            <div style="height: 14px"></div>
            <a href="/admin?notice=Admin%20key%20created">Back</a>
          </div>
          `
        )
      );
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/rotate", requireAdminReady, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      const r = await keyStore.rotate(id);
      res.type("html").send(
        renderPage(
          "Key Rotated",
          `
          <div class="card">
            <h1>Key rotated: ${escapeHtml(r.id)}</h1>
            <p class="bad"><strong>Copy this key now</strong>. You will not be able to view it again.</p>
            <div class="card" style="margin-top:12px;">
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all;">${escapeHtml(r.key)}</div>
            </div>
            <div style="height: 14px"></div>
            <a href="/admin">Back</a>
          </div>
          `
        )
      );
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/enable", requireAdminReady, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.setEnabled(id, true);
      res.redirect("/admin?notice=Key%20enabled");
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/disable", requireAdminReady, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.setEnabled(id, false);
      res.redirect("/admin?notice=Key%20disabled");
    } catch (e) {
      next(e);
    }
  });

  router.post("/keys/:id/revoke", requireAdminReady, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      await keyStore.revoke(id);
      res.redirect("/admin?notice=Key%20revoked");
    } catch (e) {
      next(e);
    }
  });

  return router;
}

module.exports = { adminRouter };
