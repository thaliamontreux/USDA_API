# Admin Control Panel (Keys + MFA)

The admin control panel is served from the same server:

- URL: `https://usfooddb.translife.online/admin`

## Bootstrap admin account

On first run, the server bootstraps a single admin user in `data/admin_users.json`:

- Username: `admin`
- Password: `admin`
- `mustChangePassword`: `true`

This is intentional so the system can be brought up unattended, but it is only safe if you **change the password immediately**.

## Required security steps

After login, the UI enforces these steps in order:

1. **Change password** (required)
2. **Configure MFA** (required)
   - TOTP (authenticator app)
   - and/or Passkeys/Security Keys (WebAuthn)
3. **Verify MFA** for the current session
4. Access API key management

If you skip any step, the server redirects you back to the required page.

## TOTP (Authenticator App)

In `/admin/setup-mfa` choose **Start / Reset TOTP**.

- Scan the QR code with an authenticator app.
- Enter the 6-digit code to enable.

## Passkeys / Security keys (WebAuthn)

In `/admin/setup-mfa` go to **Manage passkeys**.

- Click **Register passkey**.
- Your browser will prompt for a platform authenticator (passkey) or external security key.

WebAuthn requires:

- `RP_ID=usfooddb.translife.online`
- `ORIGIN=https://usfooddb.translife.online`

These are set in `.env`.

## API key management

After password + MFA are complete, `/admin` shows the two API keys:

- `key1`
- `key2`

You can:

- Rotate a key (new key is shown **once**)
- Disable/Enable a key

Keys are stored hashed in `data/keys.json`. Only the last 4 characters are shown in the UI.

## Using keys in clients

Send either header:

- `x-api-key: <key>`
- `Authorization: Bearer <key>`
