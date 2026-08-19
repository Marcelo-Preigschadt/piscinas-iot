#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <math.h>

#define FIRMWARE_VERSION "1.3.0"

const char* API_BASE =
  "https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control";

const int NUM_MOTORES = 6;

// Canal 1 mantém os pinos do projeto atual.
// Canais 2 a 6 ficam reservados para expansão do painel multimotor.
const int PIN_RELE[NUM_MOTORES] = {26, 25, 33, 32, 23, 22};
const int PIN_RETORNO[NUM_MOTORES] = {27, 14, 13, 34, 35, 39};
const int PIN_BOOT = 0;

const bool RELE_ATIVO_EM_LOW = true;
const bool RETORNO_ATIVO_EM_HIGH = true;

const unsigned long TEMPO_RESET_WIFI = 5000;
const unsigned long TEMPO_ESTABILIZAR_RETORNO = 150;
const unsigned long TEMPO_DEBOUNCE_RETORNO = 80;
const unsigned long TEMPO_MAX_RETORNO_COMANDO = 5000;
const unsigned long INTERVALO_PING = 1500;
const unsigned long INTERVALO_PING_FALHA = 5000;
const unsigned long INTERVALO_REGISTRO = 15000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 8000;
const unsigned long TEMPO_ABRIR_PORTAL_SEM_WIFI = 120000;

const char* SENHA_AP = "quatrin123";
IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GATEWAY(192, 168, 4, 1);
IPAddress AP_SUBNET(255, 255, 255, 0);

Preferences preferences;
WebServer servidor(80);
DNSServer dnsServer;
WiFiClientSecure clienteHTTPS;
TaskHandle_t tarefaBootHandle = nullptr;

String deviceId;
String deviceSecret;
String nomeRedeAP;
String wifiSsid;
String wifiSenha;

volatile bool estadoRele[NUM_MOTORES] = {false, false, false, false, false, false};
bool modoConfiguracao = false;
bool dispositivoRegistrado = false;
int falhasHttpConsecutivas = 0;

uint32_t ultimoComandoRecebido[NUM_MOTORES] = {0, 0, 0, 0, 0, 0};
uint32_t ultimoComandoConfirmado[NUM_MOTORES] = {0, 0, 0, 0, 0, 0};
uint32_t comandoAguardandoSeq[NUM_MOTORES] = {0, 0, 0, 0, 0, 0};
bool aguardandoRetorno[NUM_MOTORES] = {false, false, false, false, false, false};
bool estadoEsperadoRetorno[NUM_MOTORES] = {false, false, false, false, false, false};
unsigned long inicioAguardandoRetorno[NUM_MOTORES] = {0, 0, 0, 0, 0, 0};
unsigned long inicioRetornoCorreto[NUM_MOTORES] = {0, 0, 0, 0, 0, 0};

bool retornoInicializado[NUM_MOTORES] = {false, false, false, false, false, false};
bool ultimoEstadoRetorno[NUM_MOTORES] = {false, false, false, false, false, false};
bool motorConfirmadoLigado[NUM_MOTORES] = {false, false, false, false, false, false};
bool envioEstadoPrioritario = false;
unsigned long instanteMudancaRetorno = 0;

bool bloqueioRearme[NUM_MOTORES] = {false, false, false, false, false, false};
String motivoBloqueio[NUM_MOTORES];

unsigned long ultimoPing = 0;
unsigned long ultimaTentativaWifi = 0;
unsigned long ultimaTentativaRegistro = 0;
unsigned long inicioSemWifi = 0;

float leituraPH = NAN;
float leituraTemperatura = NAN;
float leituraORP = NAN;

bool canalValido(int canal) {
  return canal >= 0 && canal < NUM_MOTORES;
}

void controlarRele(int canal, bool ligar) {
  if (!canalValido(canal)) return;
  estadoRele[canal] = ligar;
  digitalWrite(
    PIN_RELE[canal],
    RELE_ATIVO_EM_LOW ? (ligar ? LOW : HIGH) : (ligar ? HIGH : LOW)
  );

  Serial.print("MOTOR ");
  Serial.print(canal + 1);
  Serial.println(ligar ? " | RELE: LIGADO" : " | RELE: DESLIGADO");
}

void desligarTodosReles() {
  for (int i = 0; i < NUM_MOTORES; i++) controlarRele(i, false);
}

bool motorLigadoReal(int canal) {
  if (!canalValido(canal)) return false;
  const int nivel = digitalRead(PIN_RETORNO[canal]);
  return RETORNO_ATIVO_EM_HIGH ? (nivel == HIGH) : (nivel == LOW);
}

void definirBloqueio(int canal, bool ativo, const String& motivo = "") {
  if (!canalValido(canal)) return;
  bloqueioRearme[canal] = ativo;
  motivoBloqueio[canal] = ativo ? motivo : "";
  envioEstadoPrioritario = true;
  instanteMudancaRetorno = millis();

  Serial.print("MOTOR ");
  Serial.print(canal + 1);
  if (ativo) {
    Serial.print(" | BLOQUEIO DE REARME: ");
    Serial.println(motivoBloqueio[canal]);
  } else {
    Serial.println(" | Bloqueio de rearme liberado por novo comando.");
  }
}

void observarRetornoFisico(int canal) {
  const bool atual = motorLigadoReal(canal);

  if (!retornoInicializado[canal]) {
    retornoInicializado[canal] = true;
    ultimoEstadoRetorno[canal] = atual;
    return;
  }

  if (atual == ultimoEstadoRetorno[canal]) return;

  ultimoEstadoRetorno[canal] = atual;
  instanteMudancaRetorno = millis();
  envioEstadoPrioritario = true;

  Serial.print("MOTOR ");
  Serial.print(canal + 1);
  Serial.print(" | RETORNO GPIO ");
  Serial.print(PIN_RETORNO[canal]);
  Serial.print(" MUDOU: ");
  Serial.println(atual ? "LIGADO" : "DESLIGADO");

  if (!atual && estadoRele[canal] && motorConfirmadoLigado[canal] && !aguardandoRetorno[canal]) {
    Serial.print("MOTOR ");
    Serial.print(canal + 1);
    Serial.println(" | Retorno perdido. Desarmando rele por seguranca.");
    controlarRele(canal, false);
    motorConfirmadoLigado[canal] = false;
    definirBloqueio(canal, true, "retorno_perdido");
  }
}

void observarTodosRetornos() {
  for (int i = 0; i < NUM_MOTORES; i++) observarRetornoFisico(i);
}

String gerarSecret() {
  String resultado;
  resultado.reserve(64);
  for (int i = 0; i < 8; i++) {
    uint32_t numero = esp_random();
    char bloco[9];
    snprintf(bloco, sizeof(bloco), "%08lX", (unsigned long)numero);
    resultado += bloco;
  }
  return resultado;
}

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
  nomeRedeAP = "AquaControl-" + deviceId.substring(deviceId.length() - 6);

  preferences.begin("aquacontrol", false);
  deviceSecret = preferences.getString("secret", "");
  if (deviceSecret.length() < 20) {
    deviceSecret = gerarSecret();
    preferences.putString("secret", deviceSecret);
  }
  preferences.end();

  Serial.println();
  Serial.println("================================");
  Serial.println("QUATRIN AQUACONTROL MULTIMOTOR");
  Serial.println("================================");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  Serial.println("Canais de motor: 6");
  Serial.println("================================");
}

bool carregarWifiSalvo() {
  preferences.begin("wifi", true);
  wifiSsid = preferences.getString("ssid", "");
  wifiSenha = preferences.getString("senha", "");
  preferences.end();
  return !wifiSsid.isEmpty();
}

void salvarWifi(const String& ssid, const String& senha) {
  preferences.begin("wifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("senha", senha);
  preferences.end();
  wifiSsid = ssid;
  wifiSenha = senha;
}

void apagarSomenteWifi() {
  Preferences wifiPrefs;
  if (wifiPrefs.begin("wifi", false)) {
    wifiPrefs.remove("ssid");
    wifiPrefs.remove("senha");
    wifiPrefs.end();
  }
  wifiSsid = "";
  wifiSenha = "";
}

void tarefaMonitorBoot(void* parametro) {
  bool armado = false;
  unsigned long inicioPressionado = 0;

  for (;;) {
    const bool pressionado = digitalRead(PIN_BOOT) == LOW;

    if (!pressionado) {
      armado = true;
      inicioPressionado = 0;
    } else if (armado) {
      if (inicioPressionado == 0) {
        inicioPressionado = millis();
        Serial.println("BOOT pressionado. Segure 5 s para trocar o Wi-Fi.");
      }

      if (millis() - inicioPressionado >= TEMPO_RESET_WIFI) {
        armado = false;
        for (int i = 0; i < NUM_MOTORES; i++) {
          estadoRele[i] = false;
          digitalWrite(PIN_RELE[i], RELE_ATIVO_EM_LOW ? HIGH : LOW);
        }
        apagarSomenteWifi();
        Serial.println("Wi-Fi apagado. Device ID e Secret mantidos. Reiniciando...");
        Serial.flush();
        vTaskDelay(pdMS_TO_TICKS(250));
        ESP.restart();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void iniciarMonitorBootIndependente() {
  if (tarefaBootHandle != nullptr) return;
  xTaskCreatePinnedToCore(
    tarefaMonitorBoot,
    "AquaBootReset",
    4096,
    nullptr,
    3,
    &tarefaBootHandle,
    1
  );
}

String escaparHTML(String texto) {
  texto.replace("&", "&amp;");
  texto.replace("<", "&lt;");
  texto.replace(">", "&gt;");
  texto.replace("\"", "&quot;");
  return texto;
}

String escaparJSON(String texto) {
  texto.replace("\\", "\\\\");
  texto.replace("\"", "\\\"");
  texto.replace("\n", "\\n");
  texto.replace("\r", "\\r");
  return texto;
}

bool conectarWifiSalvo(unsigned long timeoutMs = 20000) {
  if (wifiSsid.isEmpty()) return false;

  clienteHTTPS.stop();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.disconnect(true, false);
  delay(300);
  WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < timeoutMs) delay(250);

  if (WiFi.status() == WL_CONNECTED) {
    wifiSsid = WiFi.SSID();
    inicioSemWifi = 0;
    Serial.print("Wi-Fi conectado: ");
    Serial.print(WiFi.SSID());
    Serial.print(" | IP: ");
    Serial.print(WiFi.localIP());
    Serial.print(" | RSSI: ");
    Serial.println(WiFi.RSSI());
    return true;
  }

  return false;
}

String paginaConfiguracao() {
  String html;
  html.reserve(7000);
  html += R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quatrin AquaControl</title><style>
*{box-sizing:border-box;font-family:Arial,sans-serif}body{margin:0;background:#eef5f8;color:#123449}.topo{background:#062a3d;color:white;padding:30px 20px;text-align:center}.c{max-width:520px;margin:28px auto;background:white;padding:25px;border-radius:18px}label{display:block;margin:18px 0 7px;font-weight:bold}select,input,button{width:100%;min-height:50px;padding:12px;border-radius:10px;font-size:16px}select,input{border:1px solid #cbdce4}button{margin-top:22px;border:0;background:#008fc5;color:white;font-weight:bold}.id{font-family:monospace;color:#075879}
</style></head><body><div class="topo"><h1>Quatrin AquaControl</h1><p>Configuracao de rede</p></div><div class="c"><h2>Conectar ao Wi-Fi</h2><form method="POST" action="/salvar"><label>Rede Wi-Fi</label><select name="ssid" required>
)rawliteral";

  int quantidade = WiFi.scanNetworks();
  if (quantidade <= 0) {
    html += "<option value=''>Nenhuma rede encontrada</option>";
  } else {
    for (int i = 0; i < quantidade; i++) {
      String ssid = WiFi.SSID(i);
      html += "<option value=\"" + escaparHTML(ssid) + "\">" + escaparHTML(ssid) + " • " + String(WiFi.RSSI(i)) + " dBm</option>";
    }
  }
  WiFi.scanDelete();

  html += "</select><label>Senha</label><input type='password' name='senha'><button type='submit'>Salvar e conectar</button></form><p>ID: <span class='id'>";
  html += escaparHTML(deviceId);
  html += "</span></p></div></body></html>";
  return html;
}

void tratarSalvarWifi() {
  if (!servidor.hasArg("ssid")) {
    servidor.send(400, "text/plain", "Rede nao informada.");
    return;
  }

  String novoSsid = servidor.arg("ssid");
  String novaSenha = servidor.arg("senha");
  novoSsid.trim();
  if (novoSsid.isEmpty()) {
    servidor.send(400, "text/plain", "Rede invalida.");
    return;
  }

  salvarWifi(novoSsid, novaSenha);
  servidor.send(200, "text/html", "<html><body><h2>Wi-Fi salvo. Reiniciando...</h2></body></html>");
  delay(1200);
  ESP.restart();
}

void iniciarModoConfiguracao() {
  if (modoConfiguracao) return;

  modoConfiguracao = true;
  dispositivoRegistrado = false;
  desligarTodosReles();
  clienteHTTPS.stop();

  WiFi.disconnect(true, false);
  delay(400);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(nomeRedeAP.c_str(), SENHA_AP);

  dnsServer.start(53, "*", AP_IP);
  servidor.on("/", HTTP_GET, []() { servidor.send(200, "text/html", paginaConfiguracao()); });
  servidor.on("/salvar", HTTP_POST, tratarSalvarWifi);
  auto redirecionar = []() {
    servidor.sendHeader("Location", "/");
    servidor.send(302, "text/plain", "");
  };
  servidor.on("/generate_204", HTTP_GET, redirecionar);
  servidor.on("/gen_204", HTTP_GET, redirecionar);
  servidor.on("/hotspot-detect.html", HTTP_GET, redirecionar);
  servidor.on("/fwlink", HTTP_GET, redirecionar);
  servidor.onNotFound(redirecionar);
  servidor.begin();

  Serial.print("Portal Wi-Fi: ");
  Serial.print(nomeRedeAP);
  Serial.print(" | senha: ");
  Serial.println(SENHA_AP);
}

void marcarHttpOk() {
  falhasHttpConsecutivas = 0;
}

void marcarHttpFalha() {
  falhasHttpConsecutivas++;
  clienteHTTPS.stop();
  Serial.print("Falha HTTP consecutiva: ");
  Serial.println(falhasHttpConsecutivas);
}

String httpPost(const String& rota, const String& payload, int& codigoHTTP) {
  codigoHTTP = -1;
  if (WiFi.status() != WL_CONNECTED) return "";

  HTTPClient http;
  String url = String(API_BASE) + rota;
  if (!http.begin(clienteHTTPS, url)) {
    marcarHttpFalha();
    return "";
  }

  http.setReuse(true);
  http.setConnectTimeout(2500);
  http.setTimeout(4500);
  http.addHeader("Content-Type", "application/json");

  codigoHTTP = http.POST(payload);
  String resposta = codigoHTTP > 0 ? http.getString() : "";
  http.end();

  if (codigoHTTP >= 200 && codigoHTTP < 300) marcarHttpOk();
  else marcarHttpFalha();

  return resposta;
}

String valorJson(const String& json, const String& chave) {
  String busca = "\"" + chave + "\"";
  int i = json.indexOf(busca);
  if (i < 0) return "";
  i = json.indexOf(':', i);
  if (i < 0) return "";
  i++;
  while (i < json.length() && (json[i] == ' ' || json[i] == '\n' || json[i] == '\r')) i++;
  if (i >= json.length() || json.substring(i, i + 4) == "null" || json[i] != '"') return "";
  int fim = json.indexOf('"', i + 1);
  if (fim < 0) return "";
  return json.substring(i + 1, fim);
}

uint32_t valorJsonUInt(const String& json, const String& chave) {
  String busca = "\"" + chave + "\"";
  int i = json.indexOf(busca);
  if (i < 0) return 0;
  i = json.indexOf(':', i);
  if (i < 0) return 0;
  i++;
  while (i < json.length() && (json[i] == ' ' || json[i] == '\n' || json[i] == '\r' || json[i] == '"')) i++;
  uint32_t valor = 0;
  bool encontrou = false;
  while (i < json.length() && json[i] >= '0' && json[i] <= '9') {
    encontrou = true;
    valor = valor * 10 + (json[i] - '0');
    i++;
  }
  return encontrou ? valor : 0;
}

bool extrairComandoCanal(const String& json, int canal, String& comando, uint32_t& seq) {
  int posArray = json.indexOf("\"comandos\"");
  if (posArray < 0) return false;
  int ini = json.indexOf('[', posArray);
  int fim = json.indexOf(']', ini);
  if (ini < 0 || fim < 0) return false;

  int pos = ini + 1;
  while (pos < fim) {
    int objIni = json.indexOf('{', pos);
    if (objIni < 0 || objIni >= fim) break;
    int objFim = json.indexOf('}', objIni);
    if (objFim < 0 || objFim > fim) break;

    String obj = json.substring(objIni, objFim + 1);
    int c = (int)valorJsonUInt(obj, "canal");
    if (c == canal) {
      comando = valorJson(obj, "comando");
      seq = valorJsonUInt(obj, "comando_seq");
      return !comando.isEmpty() && seq > 0;
    }
    pos = objFim + 1;
  }

  return false;
}

String ipAtualTexto() {
  if (WiFi.status() != WL_CONNECTED) return "";
  return WiFi.localIP().toString();
}

void registrarDispositivo() {
  if (WiFi.status() != WL_CONNECTED) return;

  ultimaTentativaRegistro = millis();

  String payload = "{";
  payload += "\"device_id\":\"" + deviceId + "\",";
  payload += "\"device_secret\":\"" + deviceSecret + "\",";
  payload += "\"nome\":\"Quatrin AquaControl\",";
  payload += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\",";
  payload += "\"wifi_ssid\":\"" + escaparJSON(WiFi.SSID()) + "\",";
  payload += "\"wifi_ip\":\"" + ipAtualTexto() + "\",";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI());
  payload += "}";

  int codigo;
  String resposta = httpPost("/device/register", payload, codigo);
  dispositivoRegistrado = codigo >= 200 && codigo < 300;

  if (dispositivoRegistrado) {
    wifiSsid = WiFi.SSID();
    Serial.println("Controlador registrado.");
    String pairing = valorJson(resposta, "pairing_code");
    if (!pairing.isEmpty()) {
      Serial.print("CODIGO DE PAREAMENTO: ");
      Serial.println(pairing);
    }
  } else {
    Serial.println("Registro falhou. Nova tentativa somente apos o intervalo de registro.");
  }
}

void confirmarProcessamentoComando(int canal, const String& motivoFalha = "") {
  ultimoComandoConfirmado[canal] = comandoAguardandoSeq[canal];
  aguardandoRetorno[canal] = false;
  inicioRetornoCorreto[canal] = 0;
  inicioAguardandoRetorno[canal] = 0;
  envioEstadoPrioritario = true;
  instanteMudancaRetorno = millis();

  if (!motivoFalha.isEmpty()) definirBloqueio(canal, true, motivoFalha);
}

void atualizarConfirmacaoFisica(int canal) {
  if (!aguardandoRetorno[canal]) return;

  const bool estadoReal = motorLigadoReal(canal);

  if (estadoReal == estadoEsperadoRetorno[canal]) {
    if (inicioRetornoCorreto[canal] == 0) inicioRetornoCorreto[canal] = millis();

    if (millis() - inicioRetornoCorreto[canal] >= TEMPO_ESTABILIZAR_RETORNO) {
      motorConfirmadoLigado[canal] = estadoEsperadoRetorno[canal];
      confirmarProcessamentoComando(canal);
      Serial.print("MOTOR ");
      Serial.print(canal + 1);
      Serial.print(" | COMANDO CONFIRMADO PELO RETORNO. Seq: ");
      Serial.println(ultimoComandoConfirmado[canal]);
      return;
    }
  } else {
    inicioRetornoCorreto[canal] = 0;
  }

  if (inicioAguardandoRetorno[canal] > 0 &&
      millis() - inicioAguardandoRetorno[canal] >= TEMPO_MAX_RETORNO_COMANDO) {

    const String motivo = estadoEsperadoRetorno[canal]
      ? "sem_retorno_apos_comando"
      : "motor_permanece_ligado";

    Serial.print("MOTOR ");
    Serial.print(canal + 1);
    Serial.print(" | TIMEOUT DO RETORNO: ");
    Serial.println(motivo);

    controlarRele(canal, false);
    motorConfirmadoLigado[canal] = false;
    confirmarProcessamentoComando(canal, motivo);
  }
}

void atualizarTodasConfirmacoes() {
  for (int i = 0; i < NUM_MOTORES; i++) atualizarConfirmacaoFisica(i);
}

String montarPing() {
  atualizarTodasConfirmacoes();

  String json = "{";
  json += "\"device_id\":\"" + deviceId + "\",";
  json += "\"device_secret\":\"" + deviceSecret + "\",";
  json += "\"wifi_ssid\":\"" + escaparJSON(WiFi.SSID()) + "\",";
  json += "\"wifi_ip\":\"" + ipAtualTexto() + "\",";
  json += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\",";

  // Compatibilidade do canal 1 com versões anteriores da API.
  json += "\"motor_status\":\"" + String(motorLigadoReal(0) ? "ligado" : "desligado") + "\",";
  json += "\"rele_status\":\"" + String(estadoRele[0] ? "ligado" : "desligado") + "\",";
  json += "\"bloqueio_rearme\":" + String(bloqueioRearme[0] ? "true" : "false") + ",";
  if (bloqueioRearme[0]) json += "\"motivo_bloqueio\":\"" + escaparJSON(motivoBloqueio[0]) + "\",";
  else json += "\"motivo_bloqueio\":null,";
  if (ultimoComandoConfirmado[0] > 0) json += "\"ack_seq\":" + String(ultimoComandoConfirmado[0]) + ",";

  json += "\"motores\":[";
  for (int i = 0; i < NUM_MOTORES; i++) {
    if (i > 0) json += ",";
    json += "{";
    json += "\"canal\":" + String(i + 1) + ",";
    json += "\"motor_status\":\"" + String(motorLigadoReal(i) ? "ligado" : "desligado") + "\",";
    json += "\"rele_status\":\"" + String(estadoRele[i] ? "ligado" : "desligado") + "\",";
    json += "\"bloqueio_rearme\":" + String(bloqueioRearme[i] ? "true" : "false") + ",";
    if (bloqueioRearme[i]) json += "\"motivo_bloqueio\":\"" + escaparJSON(motivoBloqueio[i]) + "\"";
    else json += "\"motivo_bloqueio\":null";
    if (ultimoComandoConfirmado[i] > 0) json += ",\"ack_seq\":" + String(ultimoComandoConfirmado[i]);
    json += "}";
  }
  json += "]";

  if (!isnan(leituraPH)) json += ",\"ph\":" + String(leituraPH, 2);
  if (!isnan(leituraTemperatura)) json += ",\"temperatura_c\":" + String(leituraTemperatura, 2);
  if (!isnan(leituraORP)) json += ",\"orp_mv\":" + String(leituraORP, 0);

  json += "}";
  return json;
}

void processarComando(int canal, const String& comando, uint32_t seq) {
  if (!canalValido(canal)) return;
  if (seq <= ultimoComandoRecebido[canal]) return;
  if (comando != "ligar" && comando != "desligar") return;

  const bool ligar = comando == "ligar";

  definirBloqueio(canal, false);
  controlarRele(canal, ligar);

  ultimoComandoRecebido[canal] = seq;
  comandoAguardandoSeq[canal] = seq;
  estadoEsperadoRetorno[canal] = ligar;
  aguardandoRetorno[canal] = true;
  inicioAguardandoRetorno[canal] = millis();
  inicioRetornoCorreto[canal] = 0;

  if (!ligar) motorConfirmadoLigado[canal] = false;

  Serial.print("MOTOR ");
  Serial.print(canal + 1);
  Serial.print(" | COMANDO RECEBIDO: ");
  Serial.print(comando);
  Serial.print(" | SEQ: ");
  Serial.println(seq);
}

bool enviarPing() {
  if (WiFi.status() != WL_CONNECTED || !dispositivoRegistrado) return false;

  int codigo;
  String resposta = httpPost("/device/ping", montarPing(), codigo);
  if (codigo < 200 || codigo >= 300) return false;

  for (int i = 0; i < NUM_MOTORES; i++) {
    String comando;
    uint32_t seq = 0;
    if (extrairComandoCanal(resposta, i + 1, comando, seq)) {
      processarComando(i, comando, seq);
    }
  }

  atualizarTodasConfirmacoes();
  return true;
}

void wifiReconectado() {
  wifiSsid = WiFi.SSID();
  inicioSemWifi = 0;
  falhasHttpConsecutivas = 0;
  dispositivoRegistrado = false;
  clienteHTTPS.stop();
  ultimaTentativaRegistro = 0;

  Serial.print("Wi-Fi reconectado: ");
  Serial.print(WiFi.SSID());
  Serial.print(" | RSSI: ");
  Serial.println(WiFi.RSSI());
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_BOOT, INPUT_PULLUP);

  for (int i = 0; i < NUM_MOTORES; i++) {
    pinMode(PIN_RELE[i], OUTPUT);
    // GPIO 34/35/39 não possuem pull-down interno.
    if (PIN_RETORNO[i] == 34 || PIN_RETORNO[i] == 35 || PIN_RETORNO[i] == 39) pinMode(PIN_RETORNO[i], INPUT);
    else pinMode(PIN_RETORNO[i], INPUT_PULLDOWN);
    controlarRele(i, false);
  }

  observarTodosRetornos();
  iniciarMonitorBootIndependente();

  clienteHTTPS.setInsecure();
  carregarIdentidade();

  if (!carregarWifiSalvo()) {
    iniciarModoConfiguracao();
    return;
  }

  if (conectarWifiSalvo()) {
    registrarDispositivo();
    if (dispositivoRegistrado) {
      delay(100);
      enviarPing();
      ultimoPing = millis();
    }
  } else {
    inicioSemWifi = millis();
  }
}

void loop() {
  observarTodosRetornos();
  atualizarTodasConfirmacoes();

  if (modoConfiguracao) {
    dnsServer.processNextRequest();
    servidor.handleClient();
    delay(5);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (inicioSemWifi == 0) inicioSemWifi = millis();

    if (millis() - ultimaTentativaWifi >= INTERVALO_RECONEXAO_WIFI) {
      ultimaTentativaWifi = millis();
      clienteHTTPS.stop();
      dispositivoRegistrado = false;

      WiFi.disconnect(false, false);
      delay(150);
      WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

      unsigned long inicioTentativa = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - inicioTentativa < 5000) delay(100);

      if (WiFi.status() == WL_CONNECTED) {
        wifiReconectado();
        return;
      }
    }

    if (millis() - inicioSemWifi >= TEMPO_ABRIR_PORTAL_SEM_WIFI) {
      iniciarModoConfiguracao();
      return;
    }

    delay(20);
    return;
  }

  inicioSemWifi = 0;

  if (!dispositivoRegistrado) {
    if (ultimaTentativaRegistro == 0 || millis() - ultimaTentativaRegistro >= INTERVALO_REGISTRO) {
      registrarDispositivo();
      if (dispositivoRegistrado) {
        enviarPing();
        ultimoPing = millis();
      }
    }
    delay(10);
    return;
  }

  if (envioEstadoPrioritario && millis() - instanteMudancaRetorno >= TEMPO_DEBOUNCE_RETORNO) {
    if (enviarPing()) {
      envioEstadoPrioritario = false;
      ultimoPing = millis();
    }
  }

  const unsigned long intervaloAtual =
    falhasHttpConsecutivas >= 2 ? INTERVALO_PING_FALHA : INTERVALO_PING;

  if (millis() - ultimoPing >= intervaloAtual) {
    enviarPing();
    ultimoPing = millis();
  }

  delay(10);
}
