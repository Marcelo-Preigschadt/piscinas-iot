const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const result = await db.query('SELECT * FROM piscinas ORDER BY id');
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { nome, localizacao } = req.body;
  const result = await db.query(
    'INSERT INTO piscinas (nome, localizacao) VALUES ($1,$2) RETURNING *',
    [nome, localizacao]
  );
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM piscinas WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
