#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <math.h>

#define FIRMWARE_VERSION "1.2.3"

const char* API_BASE =
  "https://wqjzrbhbkienlxocykcn.supabase.co/functions/v1/piscinas-control";

const int PIN_RELE = 26;
const int PIN_RETORNO_CONTACTORA = 27;
const int PIN_BOOT = 0;

const bool RELE_ATIVO_EM_LOW = true;
const bool USAR_RETORNO_CONTACTORA = false;

const unsigned long TEMPO_RESET_WIFI = 5000;
const unsigned long INTERVALO_PING = 1200;
const unsigned long INTERVALO_PING_FALHA = 3000;
const unsigned long INTERVALO_RECONEXAO_WIFI = 10000;
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

bool modoConfiguracao = false;
bool estadoRele = false;
bool dispositivoRegistrado = false;
uint32_t ultimoComandoExecutado = 0;
int falhasHttpConsecutivas = 0;

unsigned long ultimoPing = 0;
unsigned long ultimaTentativaWifi = 0;
unsigned long inicioSemWifi = 0;

float leituraPH = NAN;
float leituraTemperatura = NAN;
float leituraORP = NAN;

void controlarRele(bool ligar) {
  estadoRele = ligar;
  digitalWrite(PIN_RELE,
    RELE_ATIVO_EM_LOW ? (ligar ? LOW : HIGH) : (ligar ? HIGH : LOW));

  Serial.println();
  Serial.println("--------------------------------");
  Serial.println(ligar ? "RELE: LIGADO" : "RELE: DESLIGADO");
  Serial.println("--------------------------------");
}

bool motorLigadoReal() {
  if (USAR_RETORNO_CONTACTORA) {
    return digitalRead(PIN_RETORNO_CONTACTORA) == LOW;
  }
  return estadoRele;
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
  snprintf(identificador, sizeof(identificador), "%04X%08X",
    (uint16_t)(chip >> 32), (uint32_t)chip);

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

bool carregarWifiSalvo() {
  preferences.begin("wifi", true);
  wifiSsid = preferences.getString("ssid", "");
  wifiSenha = preferences.getString("senha", "");
  preferences.end();

  if (wifiSsid.isEmpty()) {
    Serial.println("Nenhum Wi-Fi configurado.");
    return false;
  }

  Serial.print("Wi-Fi salvo: ");
  Serial.println(wifiSsid);
  return true;
}

void salvarWifi(const String& ssid, const String& senha) {
  preferences.begin("wifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("senha", senha);
  preferences.end();
  wifiSsid = ssid;
  wifiSenha = senha;
}

void apagarWifiSomente() {
  Preferences wifiPrefs;
  if (wifiPrefs.begin("wifi", false)) {
    wifiPrefs.remove("ssid");
    wifiPrefs.remove("senha");
    wifiPrefs.end();
  }
}

void tarefaMonitorBoot(void* parametro) {
  bool armado = false;
  unsigned long inicioPressionado = 0;

  for (;;) {
    const bool pressionado = digitalRead(PIN_BOOT) == LOW;

    // Só arma depois que o botão foi visto solto pelo menos uma vez.
    // Isso evita apagar o Wi-Fi acidentalmente durante upload/boot.
    if (!pressionado) {
      armado = true;
      inicioPressionado = 0;
    } else if (armado) {
      if (inicioPressionado == 0) {
        inicioPressionado = millis();
        Serial.println();
        Serial.println("BOOT pressionado - mantenha por 5 segundos para resetar o Wi-Fi.");
      }

      if (millis() - inicioPressionado >= TEMPO_RESET_WIFI) {
        armado = false;

        // Coloca o relé em estado seguro imediatamente, sem depender do loop().
        estadoRele = false;
        digitalWrite(PIN_RELE, RELE_ATIVO_EM_LOW ? HIGH : LOW);

        Serial.println();
        Serial.println("================================");
        Serial.println("RESET DE WI-FI AQUACONTROL");
        Serial.println("================================");

        // Apaga SOMENTE o namespace de Wi-Fi.
        // Device ID e Device Secret permanecem intactos.
        apagarWifiSomente();

        Serial.println("Wi-Fi apagado.");
        Serial.println("Device ID mantido.");
        Serial.println("Device Secret mantido.");
        Serial.println("Reiniciando controlador...");
        Serial.flush();

        vTaskDelay(pdMS_TO_TICKS(250));
        ESP.restart();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(25));
  }
}

void iniciarMonitorBootIndependente() {
  if (tarefaBootHandle != nullptr) return;

  BaseType_t ok = xTaskCreatePinnedToCore(
    tarefaMonitorBoot,
    "AquaBootReset",
    4096,
    nullptr,
    2,
    &tarefaBootHandle,
    0
  );

  if (ok == pdPASS) {
    Serial.println("Monitor independente do botão BOOT iniciado.");
  } else {
    Serial.println("ERRO: nao foi possivel iniciar o monitor do BOOT.");
  }
}

String escaparHTML(String texto) {
  texto.replace("&", "&amp;");
  texto.replace("<", "&lt;");
  texto.replace(">", "&gt;");
  texto.replace("\"", "&quot;");
  return texto;
}

bool conectarWifiSalvo(unsigned long timeoutMs = 20000) {
  if (wifiSsid.isEmpty()) return false;

  Serial.println();
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(wifiSsid);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.disconnect(true, false);
  delay(250);
  WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < timeoutMs) {
    delay(250);
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

String paginaConfiguracao() {
  String html;
  html.reserve(9000);

  html += R"rawliteral(
<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quatrin AquaControl</title>
<style>
*{box-sizing:border-box;font-family:Arial,sans-serif}body{margin:0;background:linear-gradient(180deg,#edf7fb,#f7fafb);color:#123449}.topo{background:linear-gradient(120deg,#02131d,#062a3d 65%,#075879);color:#fff;padding:32px 20px;text-align:center}.logo{width:62px;height:62px;margin:0 auto 15px;display:flex;align-items:center;justify-content:center;border-radius:18px;background:#55e0ff;color:#031824;font-size:30px;font-weight:900}.topo h1{margin:0;font-size:27px}.topo p{margin:7px 0 0;opacity:.78}.container{max-width:520px;margin:28px auto;padding:15px}.card{background:#fff;border-radius:20px;padding:25px;border:1px solid #d5e4eb;box-shadow:0 14px 35px rgba(6,42,63,.10)}.eyebrow{font-size:11px;letter-spacing:.15em;color:#008cbe;font-weight:900}h2{margin:7px 0 8px;color:#10364b}.descricao{color:#657a87;line-height:1.5;margin-bottom:22px}label{display:block;margin-top:18px;margin-bottom:7px;font-weight:bold;color:#385b6d}select,input{width:100%;min-height:50px;padding:12px 13px;border-radius:10px;border:1px solid #cbdce4;background:#fff;font-size:16px}button{width:100%;min-height:52px;margin-top:24px;padding:14px;border:0;border-radius:11px;background:linear-gradient(135deg,#008fc5,#0077b6);color:#fff;font-size:16px;font-weight:bold}.info{margin-top:22px;padding:15px;background:#edf9fe;border-radius:12px;color:#5c7482;font-size:13px;line-height:1.55}.device{display:inline-block;margin-top:5px;font-family:monospace;font-weight:bold;color:#075879}
</style></head><body><div class="topo"><div class="logo">Q</div><h1>Quatrin AquaControl</h1><p>Configuração do controlador</p></div><div class="container"><div class="card"><span class="eyebrow">CONFIGURAÇÃO DE REDE</span><h2>Conectar ao Wi-Fi</h2><p class="descricao">Selecione a rede Wi-Fi utilizada neste local e informe a senha.</p><form method="POST" action="/salvar"><label>Rede Wi-Fi</label><select name="ssid" required>
)rawliteral";

  int quantidade = WiFi.scanNetworks();
  if (quantidade <= 0) {
    html += "<option value=''>Nenhuma rede encontrada</option>";
  } else {
    for (int i = 0; i < quantidade; i++) {
      String ssid = WiFi.SSID(i);
      html += "<option value=\"" + escaparHTML(ssid) + "\">" +
              escaparHTML(ssid) + " • " + String(WiFi.RSSI(i)) + " dBm</option>";
    }
  }
  WiFi.scanDelete();

  html += R"rawliteral(
</select><label>Senha do Wi-Fi</label><input type="password" name="senha" placeholder="Digite a senha da rede"><button type="submit">Salvar e conectar</button></form><div class="info"><strong>Identificação do controlador</strong><br><span class="device">
)rawliteral";
  html += escaparHTML(deviceId);
  html += R"rawliteral(
</span><br><br>Depois de salvar, o AquaControl será reiniciado e tentará conectar automaticamente à Internet.</div></div></div></body></html>
)rawliteral";

  return html;
}

void tratarSalvarWifi() {
  if (!servidor.hasArg("ssid")) {
    servidor.send(400, "text/plain", "Rede Wi-Fi nao informada.");
    return;
  }

  String novoSsid = servidor.arg("ssid");
  String novaSenha = servidor.arg("senha");
  novoSsid.trim();

  if (novoSsid.isEmpty()) {
    servidor.send(400, "text/plain", "Rede Wi-Fi invalida.");
    return;
  }

  salvarWifi(novoSsid, novaSenha);
  servidor.send(200, "text/html",
    "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<style>body{font-family:Arial;text-align:center;background:#eef5f8;color:#123449;padding:50px 18px}.c{max-width:450px;margin:auto;background:#fff;padding:32px;border-radius:20px}</style>"
    "</head><body><div class='c'><h2>Wi-Fi configurado</h2><p>As informações foram salvas.</p><p>O controlador será reiniciado.</p></div></body></html>");

  Serial.print("Novo Wi-Fi salvo: ");
  Serial.println(novoSsid);
  delay(1500);
  ESP.restart();
}

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
  delay(400);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);

  if (!WiFi.softAP(nomeRedeAP.c_str(), SENHA_AP)) {
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

  Serial.println("Portal AquaControl iniciado.");
}

String httpPost(const String& rota, const String& payload, int& codigoHTTP) {
  codigoHTTP = -1;
  if (WiFi.status() != WL_CONNECTED) return "";

  HTTPClient http;
  String url = String(API_BASE) + rota;

  if (!http.begin(clienteHTTPS, url)) {
    falhasHttpConsecutivas++;
    return "";
  }

  http.setReuse(true);
  http.setTimeout(3500);
  http.addHeader("Content-Type", "application/json");

  codigoHTTP = http.POST(payload);
  String resposta = codigoHTTP > 0 ? http.getString() : "";
  http.end();

  if (codigoHTTP >= 200 && codigoHTTP < 300) {
    falhasHttpConsecutivas = 0;
  } else {
    falhasHttpConsecutivas++;
    if (falhasHttpConsecutivas >= 3) clienteHTTPS.stop();
  }

  Serial.print("POST ");
  Serial.print(rota);
  Serial.print(" -> HTTP ");
  Serial.println(codigoHTTP);
  if (!resposta.isEmpty()) {
    Serial.print("Servidor: ");
    Serial.println(resposta);
  }

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
  if (i >= json.length() || json.substring(i, i + 4) == "null") return 0;

  uint32_t valor = 0;
  bool encontrou = false;
  while (i < json.length() && json[i] >= '0' && json[i] <= '9') {
    encontrou = true;
    valor = valor * 10 + (json[i] - '0');
    i++;
  }
  return encontrou ? valor : 0;
}

void registrarDispositivo() {
  if (WiFi.status() != WL_CONNECTED) return;

  String payload = "{";
  payload += "\"device_id\":\"" + deviceId + "\",";
  payload += "\"device_secret\":\"" + deviceSecret + "\",";
  payload += "\"nome\":\"Quatrin AquaControl\",";
  payload += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"}";

  int codigo;
  String resposta = httpPost("/device/register", payload, codigo);

  if (codigo >= 200 && codigo < 300) {
    dispositivoRegistrado = true;
    Serial.println("ESP32 registrado no AquaControl.");
    String pairing = valorJson(resposta, "pairing_code");
    if (!pairing.isEmpty()) {
      Serial.println("********************************");
      Serial.println("CODIGO DE PAREAMENTO");
      Serial.print("        ");
      Serial.println(pairing);
      Serial.println("********************************");
    }
  } else {
    dispositivoRegistrado = false;
    Serial.println("Falha ao registrar dispositivo.");
  }
}

String montarPing() {
  String json = "{";
  json += "\"device_id\":\"" + deviceId + "\",";
  json += "\"device_secret\":\"" + deviceSecret + "\",";
  json += "\"motor_status\":\"";
  json += motorLigadoReal() ? "ligado" : "desligado";
  json += "\",";
  json += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";

  if (ultimoComandoExecutado > 0) {
    json += ",\"ack_seq\":" + String(ultimoComandoExecutado);
  }
  if (!isnan(leituraPH)) json += ",\"ph\":" + String(leituraPH, 2);
  if (!isnan(leituraTemperatura)) json += ",\"temperatura_c\":" + String(leituraTemperatura, 2);
  if (!isnan(leituraORP)) json += ",\"orp_mv\":" + String(leituraORP, 0);

  json += "}";
  return json;
}

void confirmarEstadoAoServidor() {
  int codigo;
  httpPost("/device/ping", montarPing(), codigo);
  Serial.print("ACK do comando -> HTTP ");
  Serial.println(codigo);
}

void enviarPing() {
  if (WiFi.status() != WL_CONNECTED) return;

  int codigo;
  String resposta = httpPost("/device/ping", montarPing(), codigo);
  if (codigo < 200 || codigo >= 300) return;

  String comando = valorJson(resposta, "comando");
  uint32_t comandoSeq = valorJsonUInt(resposta, "comando_seq");

  if (comandoSeq > ultimoComandoExecutado &&
      (comando == "ligar" || comando == "desligar")) {
    Serial.print("COMANDO RECEBIDO: ");
    Serial.print(comando);
    Serial.print(" | SEQ: ");
    Serial.println(comandoSeq);

    controlarRele(comando == "ligar");
    ultimoComandoExecutado = comandoSeq;

    delay(50);
    confirmarEstadoAoServidor();
    ultimoPing = millis();
  }

  String pairing = valorJson(resposta, "pairing_code");
  if (!pairing.isEmpty()) {
    Serial.print("Pareamento: ");
    Serial.println(pairing);
  }
}

void wifiReconectado() {
  Serial.println("Wi-Fi conectado novamente.");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  inicioSemWifi = 0;
  falhasHttpConsecutivas = 0;
  clienteHTTPS.stop();

  if (!dispositivoRegistrado) registrarDispositivo();
  enviarPing();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_BOOT, INPUT_PULLUP);
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_RETORNO_CONTACTORA, INPUT_PULLUP);
  controlarRele(false);

  clienteHTTPS.setInsecure();

  carregarIdentidade();
  bool possuiWifi = carregarWifiSalvo();

  // A partir daqui o BOOT é monitorado por uma tarefa independente.
  // Mesmo que HTTP/TLS fique bloqueado, o reset continua funcionando.
  iniciarMonitorBootIndependente();

  if (!possuiWifi) {
    iniciarModoConfiguracao();
    return;
  }

  if (conectarWifiSalvo()) {
    registrarDispositivo();
    delay(200);
    enviarPing();
    ultimoPing = millis();
  } else {
    inicioSemWifi = millis();
    Serial.println("Wi-Fi indisponivel. Tentaremos reconectar.");
  }
}

void loop() {
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
      WiFi.disconnect();
      WiFi.begin(wifiSsid.c_str(), wifiSenha.c_str());

      unsigned long inicioTentativa = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - inicioTentativa < 5000) {
        delay(100);
      }

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

  if (!dispositivoRegistrado) registrarDispositivo();

  unsigned long intervaloAtual =
    falhasHttpConsecutivas >= 3 ? INTERVALO_PING_FALHA : INTERVALO_PING;

  if (millis() - ultimoPing >= intervaloAtual) {
    ultimoPing = millis();
    enviarPing();
  }

  delay(20);
}
