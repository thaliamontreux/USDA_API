const express = require("express");
const { getSqlHistory, clearSqlHistory } = require("../db");

const router = express.Router();

router.get("/sql-history", (req, res) => {
  res.json({ items: getSqlHistory() });
});

router.delete("/sql-history", (req, res) => {
  clearSqlHistory();
  res.json({ ok: true });
});

module.exports = { debugRouter: router };
