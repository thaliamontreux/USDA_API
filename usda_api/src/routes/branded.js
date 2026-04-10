const express = require("express");
const { query } = require("../db");

const router = express.Router();

function asInt(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function includeSql(req) {
  return String(req.query.includeSql || "").trim() === "1";
}

router.get("/search", async (req, res, next) => {
  try {
    const upc = String(req.query.upc || "").trim();
    const brandOwner = String(req.query.brandOwner || "").trim();
    const ingredients = String(req.query.ingredients || "").trim();
    const limit = Math.min(Math.max(asInt(req.query.limit, 50), 1), 500);
    const offset = Math.max(asInt(req.query.offset, 0), 0);

    const where = [];
    const params = [];

    if (upc) {
      where.push("b.gtin_upc = ?");
      params.push(upc);
    }

    if (brandOwner) {
      where.push("LOWER(b.brand_owner) LIKE LOWER(?)");
      params.push(`%${brandOwner}%`);
    }

    if (ingredients) {
      where.push("LOWER(b.ingredients) LIKE LOWER(?)");
      params.push(`%${ingredients}%`);
    }

    const whereSql = where.length ? where.join(" AND ") : "1=1";

    const sql =
      "SELECT f.fdc_id, f.description, f.data_type, b.brand_owner, b.brand_name, b.gtin_upc " +
      "FROM branded_food b " +
      "JOIN food f ON f.fdc_id = b.fdc_id " +
      `WHERE ${whereSql} ` +
      "ORDER BY f.fdc_id DESC " +
      "LIMIT ? OFFSET ?";

    const finalParams = [...params, limit, offset];
    const { rows } = await query(sql, finalParams);

    const payload = { items: rows, limit, offset, count: rows.length };
    if (includeSql(req)) {
      payload.sql = { sql, params: finalParams };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get("/:fdcId", async (req, res, next) => {
  try {
    const fdcId = asInt(req.params.fdcId, null);
    if (!fdcId) {
      res.status(400).json({ error: "Invalid fdcId" });
      return;
    }

    const sql = "SELECT * FROM branded_food WHERE fdc_id = ?";
    const params = [fdcId];
    const { rows } = await query(sql, params);
    if (!rows.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const payload = { item: rows[0] };
    if (includeSql(req)) {
      payload.sql = { sql, params };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = { brandedRouter: router };
