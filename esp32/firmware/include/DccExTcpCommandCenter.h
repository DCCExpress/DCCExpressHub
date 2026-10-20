#pragma once
#include <WiFi.h>
#include "ICommandCenter.h"

// Nonblocking TCP connection; command station uses native DCC-EX ASCII protocol.
class DccExTcpCommandCenter final : public ICommandCenter {
public:
  const char* name() const override { return "DCC-EX TCP"; }
  void configure(const char* host,uint16_t port) {
    disconnect();
    strlcpy(host_,host,sizeof(host_));port_=port;
  }
  const char* host() const {return host_;}
  uint16_t port() const{return port_;}
  bool begin() override {nextTry_=0;return true;}
  bool connected() const override {return client_.connected() && responsive_;}
  void disconnect() {client_.stop();responsive_=false;receiving_=false;len_=0;nextTry_=millis()+1500;}
  void loop() override {
    if(WiFi.status()!=WL_CONNECTED || !port_ || !host_[0]) {
      if(client_.connected())disconnect();return;
    }
    uint32_t now=millis();
    if(!client_.connected()){
      responsive_=false;
      if((int32_t)(now-nextTry_)<0)return;
      nextTry_=now+3000;
      // Short timeout to avoid stalling UI/Runtime for too long.
      if(client_.connect(host_,port_,250)){
        lastProbe_=now;client_.print("<s>\n");
      }
      return;
    }
    uint16_t budget=256;
    while(budget-- && client_.available()){
      char c=(char)client_.read();
      if(c=='<'){receiving_=true;len_=0;}
      else if(c=='>' && receiving_){
        frame_[len_]=0;parse(frame_);receiving_=false;len_=0;
      } else if(receiving_){
        if(len_+1<sizeof(frame_))frame_[len_++]=c;
        else {receiving_=false;len_=0;}
      }
    }
    if((uint32_t)(now-lastProbe_)>=3000){
      lastProbe_=now;client_.print("<s>\n");
    }
    if(responsive_ && (uint32_t)(now-lastResponse_)>10000)disconnect();
    if(!responsive_ && (uint32_t)(now-lastProbe_)>7000)disconnect();
  }
  bool sendAccessory(uint16_t address,bool rawValue) override{
    if(!connected()||address==0||address>2044)return false;
    char output[26];
    int n=snprintf(output,sizeof(output),"<a %u %u>\n",
      (unsigned)address,rawValue?1u:0u);
    if(n<=0||(size_t)n>=sizeof(output))return false;
    if(client_.availableForWrite()<n)return false;
    return client_.write((const uint8_t*)output,n)==(size_t)n;
  }
  void onAccessoryFeedback(FeedbackCallback cb,void* ctx) override{
    feedback_=cb;context_=ctx;
  }
private:
  WiFiClient client_;
  char host_[64]{};
  uint16_t port_=2560;
  bool responsive_=false,receiving_=false;
  uint32_t nextTry_=0,lastProbe_=0,lastResponse_=0;
  char frame_[160]{};
  size_t len_=0;
  FeedbackCallback feedback_=nullptr;
  void* context_=nullptr;
  void parse(const char* frame){
    if(frame[0]=='i'||frame[0]=='p'){
      responsive_=true;lastResponse_=millis();
    }
    Serial.printf("[DCC-EX TCP] <%s>\n",frame);
    // No fake feedback: <O>, <H> are not physical confirmations.
  }
};
