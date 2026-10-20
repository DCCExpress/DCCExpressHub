#pragma once
#include <stdint.h>
#include <stddef.h>

enum class BinaryState : uint8_t { Unknown=0, Off=1, On=2 };
struct AccessoryConfig { uint16_t address; bool inverted; };
struct AccessoryCommand { uint16_t address; bool rawValue; };
struct AccessoryChanged { uint16_t address; BinaryState value; uint32_t sequence; };

template<typename T, size_t N> class FixedQueue {
public:
  bool push(const T& x) { if(count_==N)return false; items_[tail_]=x; tail_=(tail_+1)%N; ++count_; return true; }
  bool peek(T& x) const { if(!count_)return false; x=items_[head_]; return true; }
  bool pop(T& x) { if(!peek(x))return false; head_=(head_+1)%N; --count_; return true; }
  size_t size() const { return count_; }
private:
  T items_[N]{};
  size_t head_=0, tail_=0, count_=0;
};

class AccessoryRuntime {
public:
  static constexpr size_t MaxAccessories=32;
  bool SetConfig(const AccessoryConfig& cfg) {
    int i=find(cfg.address);
    if(i>=0) {
      if(accessories_[i].inverted==cfg.inverted)return true;
      if(commands_.size())return false;
      BinaryState before=GetValue(cfg.address);
      accessories_[i].inverted=cfg.inverted;
      notify(cfg.address,before);
      return true;
    }
    if(count_==MaxAccessories)return false;
    accessories_[count_++]={cfg.address,false,cfg.inverted,false};
    return true;
  }
  bool GetConfig(uint16_t address,AccessoryConfig& out) const {
    int i=find(address); if(i<0)return false;
    out={accessories_[i].address,accessories_[i].inverted};return true;
  }
  BinaryState GetValue(uint16_t address) const {
    int i=find(address);
    if(i<0||!accessories_[i].known)return BinaryState::Unknown;
    const Entry& a=accessories_[i];
    return (a.raw ^ a.inverted)?BinaryState::On:BinaryState::Off;
  }
  // Logical command. Does NOT claim that a physical state changed.
  bool SetValue(uint16_t address,bool logical) {
    int i=find(address); if(i<0)return false;
    return commands_.push({address,static_cast<bool>(logical ^ accessories_[i].inverted)});
  }
  // Called ONLY on actual driver feedback or in the test simulator.
  bool UpdateFromHardware(uint16_t address,bool raw) {
    int i=find(address); if(i<0)return false;
    BinaryState before=GetValue(address);
    accessories_[i].raw=raw; accessories_[i].known=true;
    notify(address,before);return true;
  }
  bool Invalidate(uint16_t address) {
    int i=find(address); if(i<0)return false;
    BinaryState before=GetValue(address);accessories_[i].known=false;
    notify(address,before);return true;
  }
  bool peekCommand(AccessoryCommand& out) const{return commands_.peek(out);}
  bool popCommand(AccessoryCommand& out){return commands_.pop(out);}
  bool popEvent(AccessoryChanged& out){return events_.pop(out);}
  bool overflowed() const{return overflow_;}
  size_t count() const{return count_;}
  bool addressAt(size_t i,uint16_t& out)const{
    if(i>=count_)return false;out=accessories_[i].address;return true;
  }
  uint32_t sequence() const{return sequence_;}
private:
  struct Entry{uint16_t address;bool raw;bool inverted;bool known;};
  Entry accessories_[MaxAccessories]{};
  size_t count_=0;
  FixedQueue<AccessoryCommand,16> commands_;
  FixedQueue<AccessoryChanged,32> events_;
  uint32_t sequence_=0;
  bool overflow_=false;
  int find(uint16_t address)const{
    for(size_t i=0;i<count_;++i)if(accessories_[i].address==address)return static_cast<int>(i);
    return -1;
  }
  void notify(uint16_t address,BinaryState before){
    BinaryState after=GetValue(address);
    if(before==after)return;
    ++sequence_;
    if(!events_.push({address,after,sequence_}))overflow_=true;
  }
};
