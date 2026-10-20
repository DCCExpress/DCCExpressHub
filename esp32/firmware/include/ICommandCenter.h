#pragma once
#include <Arduino.h>
#include <stdint.h>

// Hardware drivers do not know Layout, Turnout, Dispatcher or WebSocket.
// sendAccessory() returns true only when accepted for transmission,
// NOT when the actual physical accessory has moved.
class ICommandCenter {
public:
  virtual ~ICommandCenter() = default;
  virtual const char* name() const = 0;
  virtual bool begin() = 0;
  virtual void loop() = 0;
  virtual bool connected() const = 0;
  virtual bool sendAccessory(uint16_t address, bool rawValue) = 0;

  // Callback is reserved for genuine observable feedback.
  using FeedbackCallback = void (*)(void*, uint16_t, bool);
  virtual void onAccessoryFeedback(FeedbackCallback cb, void* context) = 0;
};
