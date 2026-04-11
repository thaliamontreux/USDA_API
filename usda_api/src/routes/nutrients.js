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
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(asInt(req.query.limit, 50), 1), 500);

    const where = [];
    const params = [];

    if (q) {
      where.push("LOWER(name) LIKE LOWER(?)");
      params.push(`%${q}%`);
    }

    const whereSql = where.length ? where.join(" AND ") : "1=1";

    const sql =
      "SELECT id, name, unit_name, nutrient_nbr, rank " +
      "FROM nutrient " +
      `WHERE ${whereSql} ` +
      "ORDER BY name " +
      `LIMIT ${limit}`;

    const finalParams = [...params];
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

module.exports = { nutrientsRouter: router };
