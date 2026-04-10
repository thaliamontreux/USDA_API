const express = require("express");
const { query } = require("../db");

const router = express.Router();

function asInt(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asFloat(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function includeSql(req) {
  return String(req.query.includeSql || "").trim() === "1";
}

router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(asInt(req.query.limit, 50), 1), 500);
    const offset = Math.max(asInt(req.query.offset, 0), 0);

    const dataTypeRaw = String(req.query.dataType || "").trim();
    const dataType = dataTypeRaw ? dataTypeRaw.toLowerCase() : "";

    const where = [];
    const params = [];

    if (q) {
      where.push("LOWER(f.description) LIKE LOWER(?)");
      params.push(`%${q}%`);
    }

    if (dataType) {
      where.push("LOWER(f.data_type) = ?");
      params.push(dataType);
    }

    const whereSql = where.length ? where.join(" AND ") : "1=1";

    const sql =
      "SELECT f.fdc_id, f.data_type, f.description, f.food_category_id, f.publication_date " +
      "FROM food f " +
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

    const sql = "SELECT * FROM food WHERE fdc_id = ?";
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

router.get("/:fdcId/nutrients", async (req, res, next) => {
  try {
    const fdcId = asInt(req.params.fdcId, null);
    if (!fdcId) {
      res.status(400).json({ error: "Invalid fdcId" });
      return;
    }

    const limit = Math.min(Math.max(asInt(req.query.limit, 200), 1), 2000);
    const minAmount = asFloat(req.query.minAmount, null);

    const where = ["fn.fdc_id = ?"];
    const params = [fdcId];
    if (minAmount !== null) {
      where.push("fn.amount >= ?");
      params.push(minAmount);
    }

    const whereSql = where.join(" AND ");

    const sql =
      "SELECT fn.id AS food_nutrient_id, fn.fdc_id, fn.nutrient_id, fn.amount, " +
      "n.name AS nutrient_name, n.unit_name, n.nutrient_nbr, n.rank " +
      "FROM food_nutrient fn " +
      "JOIN nutrient n ON n.id = fn.nutrient_id " +
      `WHERE ${whereSql} ` +
      "ORDER BY fn.amount DESC " +
      "LIMIT ?";

    const finalParams = [...params, limit];
    const { rows } = await query(sql, finalParams);

    const payload = { items: rows, limit, count: rows.length };
    if (includeSql(req)) {
      payload.sql = { sql, params: finalParams };
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = { foodsRouter: router };
