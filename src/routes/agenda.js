const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * LISTAR agendas de uma piscina
 * GET /agenda/:piscinaId
 */
router.get('/:piscinaId', async (req, res) => {
  try {
    const { piscinaId } = req.params;

    const result = await pool.query(
      `SELECT id, piscina_id, dia_semana, hora_inicio, duracao_min
       FROM agendas
       WHERE piscina_id = $1
       ORDER BY dia_semana, hora_inicio`,
      [piscinaId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('ERRO GET AGENDA:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * CRIAR agenda
 * POST /agenda
 */
router.post('/', async (req, res) => {
  try {
    const { piscina_id, dia_semana, hora_inicio, duracao_min } = req.body;

    const result = await pool.query(
      `INSERT INTO agendas (piscina_id, dia_semana, hora_inicio, duracao_min)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [piscina_id, dia_semana, hora_inicio, duracao_min]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('ERRO POST AGENDA:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

/**
 * REMOVER agenda
 * DELETE /agenda/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      'DELETE FROM agendas WHERE id = $1',
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('ERRO DELETE AGENDA:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
