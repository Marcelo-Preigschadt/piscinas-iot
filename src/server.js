const express = require('express');
const cors = require('cors');
const db = require('./db');

const piscinasRoutes = require('./routes/piscinas');
const agendaRoutes = require('./routes/agenda');

const app = express();
app.use(cors());
app.use(express.json());

// ================= ROTAS EXISTENTES =================
app.use('/piscinas', piscinasRoutes);
app.use('/agenda', agendaRoutes);

// ================= LOGIN =================
app.post('/login', async (req, res) => {
  const { usuario, senha } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2',
      [usuario, senha]
    );

    if (result.rows.length > 0) {
      return res.json({ usuario: result.rows[0].usuario });
    }

    res.status(401).json({ erro: 'Usuário ou senha inválidos' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

/* ===================================================
   =============== INTEGRAÇÃO ESP32 ==================
   =================================================== */

// ESPs online em tempo real
const dispositivosOnline = {};

// ESP32 registra conexão
app.post('/device/register', (req, res) => {
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ erro: 'device_id obrigatório' });
  }

  dispositivosOnline[device_id] = {
    ip: req.ip.replace('::ffff:', ''),
    ultimoPing: Date.now()
  };

  res.json({ status: 'registrado' });
});

// Heartbeat do ESP32
app.post('/device/ping', (req, res) => {
  const { device_id } = req.body;

  if (dispositivosOnline[device_id]) {
    dispositivosOnline[device_id].ultimoPing = Date.now();
  }

  res.json({ ok: true });
});

// ================= MOTOR =================

// LIGAR MOTOR
app.post('/motor/:id/ligar', async (req, res) => {
  try {
    const piscinaId = req.params.id;

    const r = await db.query(
      `SELECT d.device_id
       FROM piscinas p
       JOIN dispositivos d ON d.id = p.dispositivo_id
       WHERE p.id = $1`,
      [piscinaId]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    }

    const deviceId = r.rows[0].device_id;
    const device = dispositivosOnline[deviceId];

    if (!device) {
      return res.status(503).json({ erro: 'ESP32 offline' });
    }

    await fetch(`http://${device.ip}/ligar`);
    res.json({ status: 'ligado' });

  } catch (err) {
    res.status(500).json({ erro: 'Falha ao ligar motor' });
  }
});

// DESLIGAR MOTOR
app.post('/motor/:id/desligar', async (req, res) => {
  try {
    const piscinaId = req.params.id;

    const r = await db.query(
      `SELECT d.device_id
       FROM piscinas p
       JOIN dispositivos d ON d.id = p.dispositivo_id
       WHERE p.id = $1`,
      [piscinaId]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    }

    const deviceId = r.rows[0].device_id;
    const device = dispositivosOnline[deviceId];

    if (!device) {
      return res.status(503).json({ erro: 'ESP32 offline' });
    }

    await fetch(`http://${device.ip}/desligar`);
    res.json({ status: 'desligado' });

  } catch (err) {
    res.status(500).json({ erro: 'Falha ao desligar motor' });
  }
});

// STATUS MOTOR
app.get('/motor/:id/status', async (req, res) => {
  try {
    const piscinaId = req.params.id;

    const r = await db.query(
      `SELECT d.device_id
       FROM piscinas p
       JOIN dispositivos d ON d.id = p.dispositivo_id
       WHERE p.id = $1`,
      [piscinaId]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ erro: 'Dispositivo não encontrado' });
    }

    const deviceId = r.rows[0].device_id;
    const device = dispositivosOnline[deviceId];

    if (!device) {
      return res.json({ status: 'offline' });
    }

    const resp = await fetch(`http://${device.ip}/status`);
    const data = await resp.json();

    res.json(data);

  } catch (err) {
    res.status(500).json({ erro: 'Falha ao obter status' });
  }
});

// ================= START =================
app.listen(3000, () => {
  console.log('API rodando em http://localhost:3000');
});
