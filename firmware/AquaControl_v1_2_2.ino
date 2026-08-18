#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <math.h>

// ======================================================
//             QUATRIN AQUACONTROL - ESP32
// ======================================================

#define FIRMWARE_VERSION "1.2.2"

// ======================================================
//                  API AQUACONTROL
// ======================================================

const char* API_BASE =
  "https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control";

// ======================================================
//                       PINOS
// ======================================================

const int PIN_RELE = 26;
const int PIN_RETORNO_CONTACTORA = 27;
const int PIN_BOOT = 0;

// ======================================================
//                  CONFIGURAÇÃO RELÉ
// ======================================================

const bool RELE_ATIVO_EM_LOW = true;
const bool USAR_RETORNO_CONTACTORA = false;

// ======================================================
//                   RESET DE WI-FI
// ======================================================

const unsigned long TEMPO_RESET_WIFI = 5000;
unsigned long inicioBootPressionado = 0;
bool resetWifiExecutado = false;

// ======================================================
//                  INTERVALOS
// ======================================================

// Polling normal. Com a conexão HTTPS reutilizável, o comando costuma
// chegar em aproximadamente 1 s sem bombardear a API com novas sessões TLS.
const unsigned long INTERVALO_PING = 1200;
const unsigned long INTERVALO_PING_FALHA = 3000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;
const unsigned long TEMPO_ABRIR_PORTAL_SEM_WIFI = 120000;

// ======================================================
//                ACCESS POINT AQUACONTROL
// ======================================================

const char* SENHA_AP = "quatrin123";

IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GATEWAY(192, 168, 4, 1);
IPAddress AP_SUBNET(255, 255, 255, 0);

// ======================================================
//                     OBJETOS
// ======================================================

Preferences preferences;
WebServer servidor(80);
DNSServer dnsServer;
WiFiClientSecure clienteHTTPS;

// ======================================================
//                 IDENTIDADE ESP32
// ======================================================

String deviceId;
String deviceSecret;
String nomeRedeAP;

// ======================================================
//                    WI-FI SALVO
// ======================================================

String wifiSsid;
String wifiSenha;

// ======================================================
//                     ESTADOS
// ======================================================

bool modoConfiguracao = false;
bool estadoRele = false;
bool dispositivoRegistrado = false;
uint32_t ultimoComandoExecutado = 0;
int falhasHttpConsecutivas = 0;

// ======================================================
//                  TEMPORIZADORES
// ======================================================

unsigned long ultimoPing = 0;
unsigned long ultimaTentativaWifi = 0;
unsigned long inicioSemWifi = 0;

// ======================================================
//                      TELEMETRIA
// ======================================================

float leituraPH = NAN;
float leituraTemperatura = NAN;
float leituraORP = NAN;

// ======================================================
//                      RELÉ
// ======================================================

void controlarRele(bool ligar) {
  estadoRele = ligar;

  if (RELE_ATIVO_EM_LOW) {
    digitalWrite(PIN_RELE, ligar ? LOW : HIGH);
  } else {
    digitalWrite(PIN_RELE, ligar ? HIGH : LOW);
  }

  Serial.println();
  Serial.println("--------------------------------");
  Serial.println(ligar ? "RELE: LIGADO" : "RELE: DESLIGADO");
  Serial.println("--------------------------------");
}

// ======================================================
//                ESTADO REAL DO MOTOR
// ======================================================

bool motorLigadoReal() {
  if (USAR_RETORNO_CONTACTORA) {
    return digitalRead(PIN_RETORNO_CONTACTORA) == LOW;
  }
  return estadoRele;
}

// ======================================================
//                GERAR DEVICE SECRET
// ======================================================

String gerarSecret() {
  String resultado = "";

  for (int i = 0; i < 8; i++) {
    uint32_t numero = esp_random();
    char bloco[9];
    snprintf(bloco, sizeof(bloco), "%08lX", (unsigned long)numero);
    resultado += bloco;
  }

  return resultado;
}

// ======================================================
//               IDENTIDADE DO CONTROLADOR
// ======================================================

void carregarIdentidade() {
  uint64_t chip = ESP.getEfuseMac();
  char identificador[13];

  snprintf(
    identificador,
    sizeof(identificador),
    "%04X%08X",
    (uint16_t)(chip >> 32),
    (uint32_t)chip
  );

  deviceId = "AQUA-" + String(identificador);
  String sufixo = deviceId.substring(deviceId.length() - 6);
  nomeRedeAP = "AquaControl-" + sufixo;

  preferences.begin("aquacontrol", false);
  deviceSecret = preferences.getString("secret", "");

  if (deviceSecret.length() < 20) {
    deviceSecret = gerarSecret();
    preferences.putString("secret", deviceSecret);
  }

  preferences.end();

  Serial.println();
  Serial.println("================================");
  Serial.println("QUATRIN AQUACONTROL");
  Serial.println("================================");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  Serial.print("Rede de configuracao: ");
  Serial.println(nomeRedeAP);
  Serial.println("================================");
}

// ======================================================
//                  CARREGAR WI-FI
// ======================================================

bool carregarWifiSalvo() {
  preferences.begin("wifi", true);
  wifiSsid = preferences.getString("ssid", "");
  wifiSenha = preferences.getString("senha", "");
  preferences.end();

  if (wifiSsid.length() == 0) {
    Serial.println("Nenhum Wi-Fi configurado.");
    return false;
  }

  Serial.print("Wi-Fi salvo: ");
  Serial.println(wifiSsid);
  return true;
}

// ======================================================
//                    SALVAR WI-FI
// ======================================================

void salvarWifi(const String& ssid, const String& senha) {
  preferences.begin("wifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("senha", senha);
  preferences.end();

  wifiSsid = ssid;
  wifiSenha = senha;
}

// ======================================================
//                    APAGAR WI-FI
// ======================================================

void apagarWifi() {
  preferences.begin("wifi", false);
  preferences.remove("ssid");
  preferences.remove("senha");
  preferences.end();

  wifiSsid = "";
  wifiSenha = "";

  Serial.println("SSID e senha apagados.");
  Serial.println("Device ID mantido.");
  Serial.println("Device Secret mantido.");
}

// ======================================================
//               BOTÃO BOOT - RESET WI-FI
// ======================================================

void verificarBotaoResetWifi() {
  if (digitalRead(PIN_BOOT) == LOW) {
    if (inicioBootPressionado == 0) {
      inicioBootPressionado = millis();
      Serial.println();
      Serial.println("BOOT pressionado.");
      Serial.println("Segure por 5 segundos para resetar o Wi-Fi...");
    }

    if (
      !resetWifiExecutado &&
      millis() - inicioBootPressionado >= TEMPO_RESET_WIFI
    ) {
      resetWifiExecutado = true;

      Serial.println();
      Serial.println("================================");
      Serial.println("RESET DE WI-FI AQUACONTROL");
      Serial.println("================================");

      controlarRele(false);
      apagarWifi();

      Serial.println();
      Serial.println("Wi-Fi removido.");
      Serial.println("Reiniciando controlador...");

      delay(1500);
      ESP.restart();
    }
  } else {
    inicioBootPressionado = 0;
    resetWifiExecutado = false;
  }
}

// ======================================================
//                 CONECTAR WI-FI SALVO
// ======================================================

bool conectarWifiSalvo(unsigned long timeoutMs = 20000) {
  if (wifiSsid.length() == 0) return false;

  Serial.println();
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(wifiSsid);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.disconnect(true, false);

  delay(300);
  WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

  unsigned long inicio = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - inicio < timeoutMs
  ) {
    verificarBotaoResetWifi();
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi conectado!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Sinal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

    inicioSemWifi = 0;
    return true;
  }

  Serial.println("Falha ao conectar ao Wi-Fi.");
  return false;
}

// ======================================================
//                   ESCAPAR HTML
// ======================================================

String escaparHTML(String texto) {
  texto.replace("&", "&amp;");
  texto.replace("<", "&lt;");
  texto.replace(">", "&gt;");
  texto.replace("\"", "&quot;");
  return texto;
}

// ======================================================
//              PÁGINA CONFIGURAÇÃO WI-FI
// ======================================================

String paginaConfiguracao() {
  String html;
  html.reserve(10000);

  html += R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quatrin AquaControl</title>
<style>
*{box-sizing:border-box;font-family:Arial,sans-serif}
body{margin:0;background:linear-gradient(180deg,#edf7fb,#f7fafb);color:#123449}
.topo{background:linear-gradient(120deg,#02131d,#062a3d 65%,#075879);color:white;padding:32px 20px;text-align:center}
.logo{width:62px;height:62px;margin:0 auto 15px;display:flex;align-items:center;justify-content:center;border-radius:18px;background:#55e0ff;color:#031824;font-size:30px;font-weight:900}
.topo h1{margin:0;font-size:27px}.topo p{margin:7px 0 0;opacity:.78}
.container{max-width:520px;margin:28px auto;padding:15px}
.card{background:white;border-radius:20px;padding:25px;border:1px solid #d5e4eb;box-shadow:0 14px 35px rgba(6,42,63,.10)}
.eyebrow{font-size:11px;letter-spacing:.15em;color:#008cbe;font-weight:900}
h2{margin:7px 0 8px;color:#10364b}.descricao{color:#657a87;line-height:1.5;margin-bottom:22px}
label{display:block;margin-top:18px;margin-bottom:7px;font-weight:bold;color:#385b6d}
select,input{width:100%;min-height:50px;padding:12px 13px;border-radius:10px;border:1px solid #cbdce4;background:#fff;font-size:16px}
select:focus,input:focus{outline:none;border-color:#55c7ec;box-shadow:0 0 0 4px rgba(6,185,239,.10)}
button{width:100%;min-height:52px;margin-top:24px;padding:14px;border:0;border-radius:11px;background:linear-gradient(135deg,#008fc5,#0077b6);color:white;font-size:16px;font-weight:bold;cursor:pointer}
.info{margin-top:22px;padding:15px;background:#edf9fe;border-radius:12px;color:#5c7482;font-size:13px;line-height:1.55}
.device{display:inline-block;margin-top:5px;font-family:monospace;font-weight:bold;color:#075879}
</style>
</head>
<body>
<div class="topo"><div class="logo">Q</div><h1>Quatrin AquaControl</h1><p>Configuração do controlador</p></div>
<div class="container"><div class="card">
<span class="eyebrow">CONFIGURAÇÃO DE REDE</span>
<h2>Conectar ao Wi-Fi</h2>
<p class="descricao">Selecione a rede Wi-Fi utilizada neste local e informe a senha.</p>
<form method="POST" action="/salvar">
<label>Rede Wi-Fi</label>
<select name="ssid" required>
)rawliteral";

  int quantidade = WiFi.scanNetworks();

  if (quantidade <= 0) {
    html += "<option value=''>Nenhuma rede encontrada</option>";
  } else {
    for (int i = 0; i < quantidade; i++) {
      String ssid = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);

      html += "<option value=\"";
      html += escaparHTML(ssid);
      html += "\">";
      html += escaparHTML(ssid);
      html += "  •  ";
      html += String(rssi);
      html += " dBm</option>";
    }
  }

  WiFi.scanDelete();

  html += R"rawliteral(
</select>
<label>Senha do Wi-Fi</label>
<input type="password" name="senha" placeholder="Digite a senha da rede">
<button type="submit">Salvar e conectar</button>
</form>
<div class="info"><strong>Identificação do controlador</strong><br><span class="device">
)rawliteral";

  html += escaparHTML(deviceId);

  html += R"rawliteral(
</span><br><br>Depois de salvar, o AquaControl será reiniciado e tentará conectar automaticamente à Internet.</div>
</div></div>
</body>
</html>
)rawliteral";

  return html;
}

// ======================================================
//                  SALVAR PELO PORTAL
// ======================================================

void tratarSalvarWifi() {
  if (!servidor.hasArg("ssid")) {
    servidor.send(400, "text/plain", "Rede Wi-Fi nao informada.");
    return;
  }

  String novoSsid = servidor.arg("ssid");
  String novaSenha = servidor.arg("senha");
  novoSsid.trim();

  if (novoSsid.length() == 0) {
    servidor.send(400, "text/plain", "Rede Wi-Fi invalida.");
    return;
  }

  salvarWifi(novoSsid, novaSenha);

  String pagina = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AquaControl</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#eef5f8;text-align:center;padding:50px 18px;color:#123449}
.caixa{max-width:450px;margin:auto;background:#fff;padding:32px;border-radius:20px;border:1px solid #d5e4eb;box-shadow:0 14px 35px rgba(6,42,63,.10)}
.ok{width:60px;height:60px;margin:0 auto 17px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#e6f9ef;color:#198054;font-size:30px}
h2{color:#075879}p{color:#657a87;line-height:1.6}
</style>
</head>
<body>
<div class="caixa"><div class="ok">✓</div><h2>Wi-Fi configurado</h2><p>As informações foram salvas.</p><p>O controlador será reiniciado e conectará à rede selecionada.</p></div>
</body>
</html>
)rawliteral";

  servidor.send(200, "text/html", pagina);

  Serial.println();
  Serial.print("Novo Wi-Fi salvo: ");
  Serial.println(novoSsid);

  delay(2500);
  ESP.restart();
}

// ======================================================
//              INICIAR PORTAL AQUACONTROL
// ======================================================

void iniciarModoConfiguracao() {
  if (modoConfiguracao) return;

  modoConfiguracao = true;
  dispositivoRegistrado = false;
  controlarRele(false);

  Serial.println();
  Serial.println("================================");
  Serial.println("MODO DE CONFIGURACAO");
  Serial.println("================================");

  WiFi.disconnect(true, false);
  delay(500);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);

  bool iniciou = WiFi.softAP(nomeRedeAP.c_str(), SENHA_AP);

  if (!iniciou) {
    Serial.println("Erro ao criar rede AquaControl.");
    return;
  }

  Serial.print("Rede criada: ");
  Serial.println(nomeRedeAP);
  Serial.print("Senha: ");
  Serial.println(SENHA_AP);
  Serial.print("Endereco: http://");
  Serial.println(WiFi.softAPIP());

  dnsServer.start(53, "*", AP_IP);

  servidor.on("/", HTTP_GET, []() {
    servidor.send(200, "text/html", paginaConfiguracao());
  });

  servidor.on("/salvar", HTTP_POST, tratarSalvarWifi);

  servidor.on("/generate_204", HTTP_GET, []() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  });

  servidor.on("/gen_204", HTTP_GET, []() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  });

  servidor.on("/hotspot-detect.html", HTTP_GET, []() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  });

  servidor.on("/fwlink", HTTP_GET, []() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  });

  servidor.onNotFound([]() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  });

  servidor.begin();

  Serial.println();
  Serial.println("Portal AquaControl iniciado.");
  Serial.println("Conecte o celular na rede acima.");
}

// ======================================================
//                    HTTP POST
// ======================================================

String httpPost(const String& rota, const String& payload, int& codigoHTTP) {
  codigoHTTP = -1;

  if (WiFi.status() != WL_CONNECTED) return "";

  HTTPClient http;
  String url = String(API_BASE) + rota;

  if (!http.begin(clienteHTTPS, url)) {
    falhasHttpConsecutivas++;
    Serial.println("Erro iniciando HTTPS.");
    return "";
  }

  http.setReuse(true);
  http.setTimeout(4500);
  http.addHeader("Content-Type", "application/json");

  codigoHTTP = http.POST(payload);
  String resposta = "";

  if (codigoHTTP > 0) {
    resposta = http.getString();
  }

  Serial.println();
  Serial.print("POST ");
  Serial.println(rota);
  Serial.print("HTTP: ");
  Serial.println(codigoHTTP);

  if (resposta.length() > 0) {
    Serial.print("Servidor: ");
    Serial.println(resposta);
  }

  http.end();

  if (codigoHTTP >= 200 && codigoHTTP < 300) {
    falhasHttpConsecutivas = 0;
  } else {
    falhasHttpConsecutivas++;
    if (falhasHttpConsecutivas >= 3) {
      clienteHTTPS.stop();
    }
  }

  return resposta;
}

// ======================================================
//                LEITORES JSON SIMPLES
// ======================================================

String valorJson(const String& json, const String& chave) {
  String busca = "\"" + chave + "\"";
  int inicio = json.indexOf(busca);
  if (inicio < 0) return "";

  inicio = json.indexOf(':', inicio);
  if (inicio < 0) return "";
  inicio++;

  while (
    inicio < json.length() &&
    (json[inicio] == ' ' || json[inicio] == '\n' || json[inicio] == '\r')
  ) {
    inicio++;
  }

  if (inicio >= json.length()) return "";
  if (json.substring(inicio, inicio + 4) == "null") return "";
  if (json[inicio] != '"') return "";

  inicio++;
  int fim = json.indexOf('"', inicio);
  if (fim < 0) return "";

  return json.substring(inicio, fim);
}

uint32_t valorJsonUInt(const String& json, const String& chave) {
  String busca = "\"" + chave + "\"";
  int inicio = json.indexOf(busca);
  if (inicio < 0) return 0;

  inicio = json.indexOf(':', inicio);
  if (inicio < 0) return 0;
  inicio++;

  while (
    inicio < json.length() &&
    (json[inicio] == ' ' || json[inicio] == '\n' || json[inicio] == '\r' || json[inicio] == '"')
  ) {
    inicio++;
  }

  if (inicio >= json.length()) return 0;
  if (json.substring(inicio, inicio + 4) == "null") return 0;

  uint32_t valor = 0;
  bool encontrou = false;

  while (inicio < json.length()) {
    char c = json[inicio];
    if (c < '0' || c > '9') break;
    encontrou = true;
    valor = valor * 10 + (c - '0');
    inicio++;
  }

  return encontrou ? valor : 0;
}

// ======================================================
//              REGISTRAR NO AQUACONTROL
// ======================================================

void registrarDispositivo() {
  if (WiFi.status() != WL_CONNECTED) return;

  String payload = "{";
  payload += "\"device_id\":\"" + deviceId + "\",";
  payload += "\"device_secret\":\"" + deviceSecret + "\",";
  payload += "\"nome\":\"Quatrin AquaControl\",";
  payload += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
  payload += "}";

  int codigo;
  String resposta = httpPost("/device/register", payload, codigo);

  if (codigo >= 200 && codigo < 300) {
    dispositivoRegistrado = true;
    Serial.println();
    Serial.println("ESP32 registrado no AquaControl.");

    String pairing = valorJson(resposta, "pairing_code");
    if (pairing.length() > 0) {
      Serial.println();
      Serial.println("********************************");
      Serial.println("CODIGO DE PAREAMENTO");
      Serial.println();
      Serial.print("        ");
      Serial.println(pairing);
      Serial.println();
      Serial.println("********************************");
    }
  } else {
    dispositivoRegistrado = false;
    Serial.println("Falha ao registrar dispositivo.");
  }
}

// ======================================================
//                   MONTAR PING
// ======================================================

String montarPing() {
  bool motorLigado = motorLigadoReal();

  String json = "{";
  json += "\"device_id\":\"" + deviceId + "\",";
  json += "\"device_secret\":\"" + deviceSecret + "\",";
  json += "\"motor_status\":\"";
  json += motorLigado ? "ligado" : "desligado";
  json += "\",";
  json += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";

  if (ultimoComandoExecutado > 0) {
    json += ",\"ack_seq\":" + String(ultimoComandoExecutado);
  }

  if (!isnan(leituraPH)) {
    json += ",\"ph\":" + String(leituraPH, 2);
  }

  if (!isnan(leituraTemperatura)) {
    json += ",\"temperatura_c\":" + String(leituraTemperatura, 2);
  }

  if (!isnan(leituraORP)) {
    json += ",\"orp_mv\":" + String(leituraORP, 0);
  }

  json += "}";
  return json;
}

// ======================================================
//         CONFIRMAR NOVO ESTADO IMEDIATAMENTE
// ======================================================

void confirmarEstadoAoServidor() {
  if (WiFi.status() != WL_CONNECTED) return;

  int codigoConfirmacao;
  String resposta = httpPost("/device/ping", montarPing(), codigoConfirmacao);

  Serial.println();
  Serial.print("ACK do comando -> HTTP ");
  Serial.println(codigoConfirmacao);

  if (codigoConfirmacao >= 200 && codigoConfirmacao < 300) {
    Serial.print("Comando confirmado. Seq: ");
    Serial.println(ultimoComandoExecutado);
  }
}

// ======================================================
//                  ENVIAR PING
// ======================================================

void enviarPing(bool processarComando = true) {
  if (WiFi.status() != WL_CONNECTED) return;

  int codigo;
  String resposta = httpPost("/device/ping", montarPing(), codigo);

  if (codigo < 200 || codigo >= 300) {
    Serial.println("Falha no ping AquaControl.");
    return;
  }

  if (!processarComando) return;

  String comando = valorJson(resposta, "comando");
  uint32_t comandoSeq = valorJsonUInt(resposta, "comando_seq");

  if (
    comandoSeq > 0 &&
    comandoSeq > ultimoComandoExecutado &&
    (comando == "ligar" || comando == "desligar")
  ) {
    Serial.println();
    Serial.println("================================");
    Serial.print("COMANDO RECEBIDO: ");
    Serial.println(comando);
    Serial.print("SEQ: ");
    Serial.println(comandoSeq);
    Serial.println("================================");

    if (comando == "ligar") {
      controlarRele(true);
    } else {
      controlarRele(false);
    }

    ultimoComandoExecutado = comandoSeq;

    // O estado é confirmado imediatamente. Se essa chamada falhar,
    // os pings seguintes continuarão enviando o mesmo ack_seq até o
    // servidor registrar a confirmação.
    delay(80);
    confirmarEstadoAoServidor();
    ultimoPing = millis();
  }

  String pairing = valorJson(resposta, "pairing_code");
  if (pairing.length() > 0) {
    Serial.print("Pareamento: ");
    Serial.println(pairing);
  }
}

// ======================================================
//                  WI-FI RECONECTOU
// ======================================================

void wifiReconectado() {
  Serial.println();
  Serial.println("Wi-Fi conectado novamente.");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  inicioSemWifi = 0;
  falhasHttpConsecutivas = 0;
  clienteHTTPS.stop();

  if (!dispositivoRegistrado) {
    registrarDispositivo();
  }

  enviarPing();
}

// ======================================================
//                       SETUP
// ======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("================================");
  Serial.println("INICIANDO AQUACONTROL");
  Serial.println("================================");

  pinMode(PIN_BOOT, INPUT_PULLUP);
  pinMode(PIN_RELE, OUTPUT);
  controlarRele(false);
  pinMode(PIN_RETORNO_CONTACTORA, INPUT_PULLUP);

  clienteHTTPS.setInsecure();

  carregarIdentidade();

  bool possuiWifi = carregarWifiSalvo();

  if (!possuiWifi) {
    iniciarModoConfiguracao();
    return;
  }

  if (conectarWifiSalvo()) {
    registrarDispositivo();
    delay(300);
    enviarPing();
    ultimoPing = millis();
  } else {
    inicioSemWifi = millis();
    Serial.println();
    Serial.println("Wi-Fi indisponivel.");
    Serial.println("Tentaremos reconectar.");
    Serial.println("Segure BOOT por 5 segundos para trocar a rede imediatamente.");
  }
}

// ======================================================
//                       LOOP
// ======================================================

void loop() {
  verificarBotaoResetWifi();

  if (modoConfiguracao) {
    dnsServer.processNextRequest();
    servidor.handleClient();
    delay(5);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (inicioSemWifi == 0) {
      inicioSemWifi = millis();
      Serial.println();
      Serial.println("Wi-Fi desconectado.");
    }

    if (millis() - ultimaTentativaWifi >= INTERVALO_RECONEXAO_WIFI) {
      ultimaTentativaWifi = millis();

      Serial.println();
      Serial.print("Tentando reconectar em ");
      Serial.println(wifiSsid);

      WiFi.disconnect();
      WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

      unsigned long inicioTentativa = millis();

      while (
        WiFi.status() != WL_CONNECTED &&
        millis() - inicioTentativa < 5000
      ) {
        verificarBotaoResetWifi();
        delay(250);
      }

      if (WiFi.status() == WL_CONNECTED) {
        wifiReconectado();
        return;
      }
    }

    if (millis() - inicioSemWifi >= TEMPO_ABRIR_PORTAL_SEM_WIFI) {
      Serial.println();
      Serial.println("Wi-Fi indisponivel por 2 minutos.");
      Serial.println("Abrindo portal de configuracao...");
      iniciarModoConfiguracao();
      return;
    }

    delay(20);
    return;
  }

  inicioSemWifi = 0;

  if (!dispositivoRegistrado) {
    registrarDispositivo();
  }

  unsigned long intervaloAtual =
    falhasHttpConsecutivas >= 3 ? INTERVALO_PING_FALHA : INTERVALO_PING;

  if (millis() - ultimoPing >= intervaloAtual) {
    ultimoPing = millis();
    enviarPing();
  }

  delay(20);
}
