const WebSocket = require('ws');

// Porta do WebSocket
const wss = new WebSocket.Server({ port: 8080 });

console.log('Servidor WebSocket rodando na porta 8080');

wss.on('connection', ws => {
  console.log('Novo dispositivo conectado');

  // Recebe mensagens do ESP32
  ws.on('message', message => {
    console.log('Mensagem recebida:', message.toString());

    // Aqui você pode atualizar o status do motor no banco
    // Ex: ligar, desligar, ou enviar estado
  });

  // Envia mensagem de teste para o ESP32
  ws.send('Conexão estabelecida com servidor WebSocket');
});
