let _webauthn = null;
const crypto = require("crypto");

async function _loadWebAuthn() {
  if (_webauthn) return _webauthn;

  // @simplewebauthn/server can be ESM; dynamic import works from CommonJS.
  // eslint-disable-next-line no-undef
  const m = await import("@simplewebauthn/server");
  _webauthn = m;
  return _webauthn;
}

function toBufferFromBase64Url(b64url) {
  return Buffer.from(String(b64url), "base64url");
}

function toBase64UrlFromBuffer(buf) {
  return Buffer.from(buf).toString("base64url");
}

function buildExclusions(user) {
  const creds = (user.webauthn && user.webauthn.credentials) || [];
  return creds.map((c) => ({
    id: toBufferFromBase64Url(c.id),
    type: "public-key",
    transports: c.transports || [],
  }));
}

function buildAllowList(user) {
  const creds = (user.webauthn && user.webauthn.credentials) || [];
  return creds.map((c) => ({
    id: toBufferFromBase64Url(c.id),
    type: "public-key",
    transports: c.transports || [],
  }));
}

function userIdToBytes(userId) {
  const s = String(userId || "");
  const hex = s.replace(/-/g, "");
  if (/^[0-9a-fA-F]{32}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  return crypto.createHash("sha256").update(s, "utf8").digest();
}

async function registrationOptions({ rpID, rpName, origin, user }) {
  const {
    generateRegistrationOptions,
  } = await _loadWebAuthn();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: userIdToBytes(user.id),
    userName: user.username,
    attestationType: "none",
    excludeCredentials: buildExclusions(user),
    authenticatorSelection: {
      userVerification: "preferred",
    },
  });
}

async function verifyRegistration({ rpID, origin, expectedChallenge, response }) {
  const {
    verifyRegistrationResponse,
  } = await _loadWebAuthn();
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

async function authenticationOptions({ rpID, user }) {
  const {
    generateAuthenticationOptions,
  } = await _loadWebAuthn();
  return generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: buildAllowList(user),
  });
}

async function verifyAuthentication({ rpID, origin, expectedChallenge, response, credential }) {
  const {
    verifyAuthenticationResponse,
  } = await _loadWebAuthn();
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: toBufferFromBase64Url(credential.id),
      credentialPublicKey: Buffer.from(credential.publicKey, "base64"),
      counter: Number(credential.counter || 0),
      transports: credential.transports || [],
    },
  });
}

module.exports = {
  toBase64UrlFromBuffer,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
};
