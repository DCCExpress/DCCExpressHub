#include "SignalAutomationEngine.h"
#include "FileStore.h"
#include "Logger.h"

namespace {
bool fits(bool ext,uint8_t outputs,int32_t value){
  if(ext)return value>=0&&value<=255;
  if(value<0||value>65535)return false;
  uint32_t mask=outputs>=16?0xffffUL:(1UL<<outputs)-1UL;
  return static_cast<uint32_t>(value)<=mask;
}
}

SignalAutomationEngine::SignalAutomationEngine(ICommandCenter& cc,LayoutRuntime& runtime,AsyncWebSocket& ws)
:_commandCenter(cc),_runtime(runtime),_ws(ws){}

bool SignalAutomationEngine::begin(fs::FS& fs,const char* path){
  _fs=&fs;_path=path;
  _runtime.onChange([this](RuntimeChangeKind k,uint16_t id,uint8_t ch){handleRuntimeChange(k,id,ch);});
  bool ok=reload();if(ok)evaluate();return ok;
}

bool SignalAutomationEngine::parseSignal(JsonObjectConst row,std::vector<SignalRuleSet>& signals) const{
  long persistedAddress=row["address"]|0L;
  if(persistedAddress<=0||persistedAddress>0xffff)return false;

  long persistedId=row["id"]|0L;
  const RuntimeAccessory* target=nullptr;

  if(persistedId>0&&persistedId<=0xffff){
    target=_runtime.findAccessoryById(
        RuntimeAccessoryKind::Signal,
        static_cast<uint16_t>(persistedId));
  }

  if(!target){
    target=_runtime.findAccessory(
        RuntimeAccessoryKind::Signal,
        static_cast<uint16_t>(persistedAddress));
  }

  if(!target){
    Logger::warn(
        "SignalAutomation: target not found id="+
        String(persistedId)+
        " address="+
        String(persistedAddress));
    return false;
  }

  const char* mode=row["mode"]|"";
  bool ext=strcmp(mode,"extended")==0;
  if(!ext&&strcmp(mode,"basic")!=0)return false;

  if(ext!=target->signalExtended){
    Logger::warn(
        "SignalAutomation: target protocol mismatch id="+
        String(target->id)+
        " address="+
        String(target->address)+
        " rule="+
        String(mode));
    return false;
  }

  int out=ext?1:target->signalOutputCount;
  int persistedOut=row["outputs"]|out;
  if(!ext&&persistedOut!=out)return false;

  long def=row["default"]|0L;
  if(!fits(ext,(uint8_t)out,def))return false;

  JsonArrayConst rawRules=row["rules"].as<JsonArrayConst>();
  if(rawRules.isNull())return false;

  SignalRuleSet signal;
  signal.id=target->id;
  signal.address=target->address;
  signal.extended=ext;
  signal.outputs=(uint8_t)out;
  signal.defaultValue=def;

  for(JsonVariantConst rv:rawRules){
    JsonObjectConst rr=rv.as<JsonObjectConst>();if(rr.isNull())continue;
    long value=rr["value"]|0L;if(!fits(ext,signal.outputs,value))continue;
    JsonArrayConst cs=rr["conditions"].as<JsonArrayConst>();if(cs.isNull()||cs.size()==0)continue;
    Rule rule;rule.value=value;bool valid=true;

    for(JsonVariantConst cv:cs){
      JsonArrayConst c=cv.as<JsonArrayConst>();if(c.isNull()){valid=false;break;}
      const char* source=c[0]|"";
      Condition cond;

      if(c.size()==3){
        long addr=c[1]|0L;int logical=c[2]|-1;
        if(addr<=0||addr>0xffff||(logical!=0&&logical!=1)){valid=false;break;}

        if(strcmp(source,"turnout")==0){
          if(!_runtime.findAccessory(RuntimeAccessoryKind::Turnout,(uint16_t)addr)){valid=false;break;}
          cond.source=Condition::Source::Turnout;
          cond.address=(uint16_t)addr;
          cond.value=logical!=0;
        }else if(strcmp(source,"sensor")==0){
          // Sensor state is authoritative by physical address. Q/q feedback,
          // simulation or any future source all end up in the same runtime map.
          cond.source=Condition::Source::Sensor;
          cond.address=(uint16_t)addr;
          cond.value=logical!=0;
        }else{valid=false;break;}
      }else if(c.size()==4){
        long id=c[1]|0L;int ch=c[2]|0;int v=c[3]|-1;
        if(id<=0||id>0xffff||ch<0||ch>1||(v!=0&&v!=1)){valid=false;break;}

        if(strcmp(source,"turnout")==0){
          RuntimeAccessory* t=_runtime.findAccessoryById(RuntimeAccessoryKind::Turnout,(uint16_t)id,(uint8_t)ch);
          if(!t){valid=false;break;}
          cond.source=Condition::Source::Turnout;
          cond.address=t->address;
          cond.value=v!=0;
        }else if(strcmp(source,"sensor")==0){
          RuntimeSensor* s=_runtime.findSensorById((uint16_t)id);
          if(!s){valid=false;break;}
          cond.source=Condition::Source::Sensor;
          cond.address=s->address;
          cond.value=v!=0;
        }else{valid=false;break;}
      }else{valid=false;break;}

      rule.conditions.push_back(cond);
    }

    if(valid&&rule.conditions.size()==cs.size())signal.rules.push_back(std::move(rule));
  }

  if(signal.rules.empty())return false;

  for(auto& existing:signals){
    const bool sameTarget=
        signal.id>0
            ? existing.id==signal.id
            : existing.id==0&&existing.address==signal.address;

    if(sameTarget){
      existing=std::move(signal);
      return true;
    }
  }

  signals.push_back(std::move(signal));
  return true;
}

bool SignalAutomationEngine::parseFile(const char* path,bool& enabled,std::vector<SignalRuleSet>& signals) const{
  if(!_fs||!path||!*path)return false;
  FileStore store(*_fs);File file=store.openRead(path);if(!file)return false;
  enabled=false;signals.clear();

  while(file.available()){
    String line=file.readStringUntil('\n');line.trim();if(line.isEmpty())continue;
    JsonDocument doc;if(deserializeJson(doc,line)||!doc.is<JsonObject>())continue;
    JsonObjectConst o=doc.as<JsonObjectConst>();const char* kind=o["kind"]|"";
    if(strcmp(kind,"meta")==0){enabled=o["enabled"]|false;continue;}
    if(strcmp(kind,"signal")==0)parseSignal(o,signals);
  }

  file.close();return true;
}

bool SignalAutomationEngine::validateFile(const char* path){
  bool e=false;std::vector<SignalRuleSet>s;return parseFile(path,e,s);
}

bool SignalAutomationEngine::reload(){
  if(!_fs)return false;
  FileStore store(*_fs);

  if(!store.exists(_path.c_str())){
    _enabled=false;
    _signals.clear();

    // A layout commit can introduce or remap sensor addresses even when no
    // automation file exists. Refresh Q/q state so LayoutRuntime stays
    // authoritative by physical sensor address.
    _commandCenter.requestSensorSnapshot(false);
    return true;
  }

  bool e=false;std::vector<SignalRuleSet>s;
  if(!parseFile(_path.c_str(),e,s))return false;
  _enabled=e;_signals=std::move(s);

  Logger::info("SignalAutomation: physical-runtime model, loaded "+String(_signals.size())+" signal(s)");

  // reload() is used after layout and signal-logic commits. The topology may
  // now refer to sensor addresses that were not part of the previous runtime.
  // Request the authoritative DCC-EX Q/q snapshot immediately.
  _commandCenter.requestSensorSnapshot(false);
  return true;
}

bool SignalAutomationEngine::conditionMatches(const Condition& c) const{
  if(c.source==Condition::Source::Sensor){
    bool on=false;
    return _runtime.getSensorState(c.address,on)&&on==c.value;
  }

  bool closed=false;
  return _runtime.getTurnoutClosed(c.address,closed)&&closed==c.value;
}

int32_t SignalAutomationEngine::desiredValue(const SignalRuleSet& s) const{
  for(const auto& r:s.rules){
    bool ok=true;
    for(const auto& c:r.conditions)if(!conditionMatches(c)){ok=false;break;}
    if(ok)return r.value;
  }
  return s.defaultValue;
}

void SignalAutomationEngine::broadcastExtended(uint16_t address,int16_t aspect){
  JsonDocument d;d["type"]="signalAspectChanged";d["data"]["address"]=address;d["data"]["aspect"]=aspect;
  String body;serializeJson(d,body);_ws.textAll(body);
}

void SignalAutomationEngine::broadcastBasic(uint16_t address,uint8_t outputs,uint16_t bits){
  for(uint8_t i=0;i<outputs;i++){
    JsonDocument d;d["type"]="accessoryChanged";d["data"]["address"]=address+i;d["data"]["active"]=((bits>>i)&1U)!=0;
    String body;serializeJson(d,body);_ws.textAll(body);
  }
}

void SignalAutomationEngine::applySignal(SignalRuleSet& s,int32_t value){
  const RuntimeAccessory* target=nullptr;

  if(s.id>0){
    target=_runtime.findAccessoryById(
        RuntimeAccessoryKind::Signal,
        s.id);
  }

  if(!target){
    target=_runtime.findAccessory(
        RuntimeAccessoryKind::Signal,
        s.address);
  }

  if(!target){
    Logger::warn(
        "SignalAutomation: target id="+
        String(s.id)+
        " address="+
        String(s.address)+
        " not found");
    return;
  }

  // The layout topology is authoritative. This is especially important for
  // level crossings where TrackElement.address is the occupancy sensor while
  // signalOutput.address is the physical accessory output.
  s.id=target->id;
  s.address=target->address;
  s.outputs=s.extended?1:target->signalOutputCount;

  int16_t runtimeValue=0;
  const bool runtimeAlreadyMatches=
      _runtime.getSignalValue(s.address,runtimeValue)&&
      runtimeValue==value;

  if(s.hasAppliedValue&&s.appliedValue==value&&runtimeAlreadyMatches)return;

  if(s.extended){
    if(value<0||value>255||!_commandCenter.setSignalAspect(s.address,(int16_t)value))return;
    _runtime.setSignal(s.address,(int16_t)value);
    broadcastExtended(s.address,(int16_t)value);
  }else{
    if(value<0||value>65535)return;
    uint16_t bits=(uint16_t)value;

    for(uint8_t i=0;i<s.outputs;i++){
      bool active=((bits>>i)&1U)!=0;
      uint16_t outputAddress=s.address+i;
      if(!_commandCenter.setAccessory(outputAddress,active))return;
      _runtime.setAccessory(outputAddress,active);
    }

    broadcastBasic(s.address,s.outputs,bits);
  }

  s.appliedValue=value;
  s.hasAppliedValue=true;
}

void SignalAutomationEngine::evaluate(){
  if(_evaluating||!_enabled)return;
  _evaluating=true;
  for(auto& s:_signals)applySignal(s,desiredValue(s));
  _evaluating=false;
}

void SignalAutomationEngine::handleRuntimeChange(RuntimeChangeKind kind,uint16_t,uint8_t){
  if(kind==RuntimeChangeKind::Turnout||kind==RuntimeChangeKind::Sensor||
     kind==RuntimeChangeKind::Accessory||kind==RuntimeChangeKind::Signal){
    evaluate();
  }
}
