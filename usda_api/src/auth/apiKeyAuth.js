function extractApiKey(req) {
  const headerKey = req.headers["x-api-key"] || req.headers["x_api_key"];
  if (headerKey) return String(headerKey).trim();

  const auth = req.headers["authorization"];
  if (!auth) return "";

  const s = String(auth).trim();
  const m = s.match(/^Bearer\s+(.+)$/i);
  if (m) return String(m[1]).trim();

  return "";
}

function apiKeyMiddleware(keyStore) {
  return async (req, res, next) => {
    try {
      const apiKey = extractApiKey(req);
      const ok = await keyStore.validateKey(apiKey);
      if (!ok) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = {
  apiKeyMiddleware,
  extractApiKey,
};
