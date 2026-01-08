const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/', async (req, res) => {
  const { usuario, senha } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2',
      [usuario, senha]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
    }

    res.json({
      ok: true,
      usuario: result.rows[0].nome
    });

  } catch (err) {
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

module.exports = router;
