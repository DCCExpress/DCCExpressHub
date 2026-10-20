#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "AccessoryRuntime.h"

static constexpr char AP_SSID[]="Hub-ESP32-Test";
static constexpr char AP_PASS[]="hub-test-1234"; // Bench only!
WebServer server(80);
AccessoryRuntime runtime;
const char* stateName(BinaryState s){
  return s==BinaryState::On?"on":s==BinaryState::Off?"off":"unknown";
}
void cors(){
  server.sendHeader("Access-Control-Allow-Origin","*"); // Bench only!
  server.sendHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers","Content-Type");
}
void reply(int code,const String& body){cors();server.send(code,"application/json",body);}
void options(const char* path){server.on(path,HTTP_OPTIONS,[](){cors();server.send(204);});}
bool addressArg(uint16_t& a){
  if(!server.hasArg("address"))return false;
  String s=server.arg("address");if(!s.length())return false;
  for(size_t i=0;i<s.length();++i)if(!isDigit(s[i]))return false;
  unsigned long n=s.toInt();if(n>65535)return false;a=static_cast<uint16_t>(n);return true;
}
bool boolArg(const char* key,bool& out){
  if(!server.hasArg(key))return false;
  String s=server.arg(key);
  if(s=="true"||s=="1"){out=true;return true;}
  if(s=="false"||s=="0"){out=false;return true;}
  return false;
}
void listAccessories(){
  String json="{\"accessories\":[";
  for(size_t i=0;i<runtime.count();++i){
    uint16_t a;runtime.addressAt(i,a);
    AccessoryConfig cfg{};runtime.GetConfig(a,cfg);
    if(i)json+=",";
    json+="{\"address\":"+String(a)+",\"inverted\":"+(cfg.inverted?"true":"false")+
          ",\"state\":\""+stateName(runtime.GetValue(a))+"\"}";
  }
  json+="],\"sequence\":"+String(runtime.sequence())+",\"overflow\":"+
        (runtime.overflowed()?"true":"false")+"}";
  reply(200,json);
}
void setLogical(){
  uint16_t a;bool v;
  if(!addressArg(a)||!boolArg("value",v)){reply(400,"{\"error\":\"bad args\"}");return;}
  reply(runtime.SetValue(a,v)?202:409,"{\"queued\":true}");
}
void feedback(){
  uint16_t a;bool v;
  if(!addressArg(a)||!boolArg("raw",v)){reply(400,"{\"error\":\"bad args\"}");return;}
  reply(runtime.UpdateFromHardware(a,v)?200:404,"{\"updated\":true}");
}
void config(){
  uint16_t a;bool inv;
  if(!addressArg(a)||!boolArg("inverted",inv)){reply(400,"{\"error\":\"bad args\"}");return;}
  reply(runtime.SetConfig({a,inv})?200:409,"{\"configured\":true}");
}
void setup(){
  Serial.begin(115200);
  runtime.SetConfig({20,true});
  runtime.SetConfig({21,false});
  WiFi.mode(WIFI_AP);WiFi.softAP(AP_SSID,AP_PASS);
  server.on("/api/accessories",HTTP_GET,listAccessories);
  server.on("/api/accessory/set",HTTP_POST,setLogical);
  server.on("/api/accessory/feedback",HTTP_POST,feedback);
  server.on("/api/accessory/config",HTTP_POST,config);
  options("/api/accessories");options("/api/accessory/set");
  options("/api/accessory/feedback");options("/api/accessory/config");
  server.begin();
  Serial.printf("AP %s, IP %s\n",AP_SSID,WiFi.softAPIP().toString().c_str());
}
void loop(){
  server.handleClient();
  // MOCK CC: queued command becomes hardware feedback.
  AccessoryCommand c;
  if(runtime.peekCommand(c)){
    Serial.printf("[MOCK TX] address=%u raw=%u\n",c.address,c.rawValue);
    AccessoryCommand removed;runtime.popCommand(removed);
    runtime.UpdateFromHardware(c.address,c.rawValue);
  }
  AccessoryChanged e;
  while(runtime.popEvent(e))
    Serial.printf("[ValueChanged] address=%u state=%s seq=%lu\n",
      e.address,stateName(e.value),(unsigned long)e.sequence);
  delay(1);
}
