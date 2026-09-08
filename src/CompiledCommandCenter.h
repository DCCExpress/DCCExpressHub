#pragma once

#include "CommandCenterBuild.h"

#if defined(HUB_CC_DCCEX)

#include "DccExBridge.h"

// DCC-EX exposes a real latched ESTOP pause state:
//
//   <!P>  = pause / lock all train movement
//   <!R>  = resume
//   <!Q>  = query pause state
//
// For safety, releasing the Hub E-STOP sends ESTOPALL immediately before
// RESUME. This sets all remembered loco speeds to zero, so trains do not
// unexpectedly restart when the pause lock is released.
class CompiledCommandCenter final
    : public DccExBridge {
public:
  void loop() override {
    DccExBridge::loop();

    const bool online =
        DccExBridge::connected();

    if (!online) {
      _pauseQuerySent =
          false;

      return;
    }

    if (!_pauseQuerySent) {
      // Query silently after every connection/reconnection. The response
      // <!PAUSED> / <!RESUMED> is intercepted by onRawInfo().
      if (
          DccExBridge::sendRawCommand(
              "<!Q>",
              false)
      ) {
        _pauseQuerySent =
            true;
      }
    }
  }

  void setEndpoint(
      const String& host,
      uint16_t port) override {
    _pauseKnown =
        false;

    _pauseQuerySent =
        false;

    DccExBridge::setEndpoint(
        host,
        port);
  }

  void onRawInfo(
      RawInfoCallback callback) override {
    _outerRawInfoCallback =
        std::move(callback);

    DccExBridge::onRawInfo(
        [this](
            const String& raw) {
          if (
              raw == "<!PAUSED>"
          ) {
            _paused =
                true;

            _pauseKnown =
                true;
          } else if (
              raw == "<!RESUMED>"
          ) {
            _paused =
                false;

            _pauseKnown =
                true;
          }

          if (_outerRawInfoCallback) {
            _outerRawInfoCallback(
                raw);
          }
        });
  }

  bool emergencyStop() override {
    // First press: latch the command station in PAUSE.
    if (
        !_pauseKnown ||
        !_paused
    ) {
      if (
          !DccExBridge::sendRawCommand(
              "<!P>")
      ) {
        return false;
      }

      _paused =
          true;

      _pauseKnown =
          true;

      return true;
    }

    // Second press: safe release.
    //
    // ESTOPALL first forces every loco reminder to speed=0. Only after that
    // do we release the pause lock, preventing an automatic restart.
    if (
        !DccExBridge::sendRawCommand(
            "<!>")
    ) {
      return false;
    }

    if (
        !DccExBridge::sendRawCommand(
            "<!R>")
    ) {
      // ESTOPALL succeeded but the layout is still paused. Keep the UI red.
      _paused =
          true;

      _pauseKnown =
          true;

      return false;
    }

    _paused =
        false;

    _pauseKnown =
        true;

    return true;
  }

  bool emergencyPauseStateKnown() const override {
    return _pauseKnown;
  }

  bool emergencyPaused() const override {
    return _paused;
  }

private:
  RawInfoCallback
      _outerRawInfoCallback;

  bool _paused = false;
  bool _pauseKnown = false;
  bool _pauseQuerySent = false;
};

#elif defined(HUB_CC_Z21)

#include "Z21CommandCenter.h"

// The Z21 firmware intentionally exposes only operations that have a safe,
// well-defined Z21 equivalent.
//
// In particular, DCCExpressHub's current "programming power" abstraction is
// DCC-EX-specific. It must never be translated into a MAIN-track power-on
// operation merely because a caller sends setProgrammingPower(false).
//
// Z21 emergency stop is not a DCC-EX-style latched pause. The first toggle
// sends the native Z21 emergency stop; the second toggle only releases the
// Hub's visual/logic latch so normal throttle commands may continue.
class CompiledCommandCenter final
    : public Z21CommandCenter {
public:
  bool setProgrammingPower(
      bool) override {
    return false;
  }

  bool setVPin(
      uint16_t,
      bool) override {
    return false;
  }

  bool supportsRawCommand() const override {
    return false;
  }

  bool sendRawCommand(
      String,
      bool = true) override {
    return false;
  }

  bool emergencyStop() override {
    if (!_emergencyActive) {
      if (
          !Z21CommandCenter::emergencyStop()
      ) {
        return false;
      }

      _emergencyActive =
          true;

      return true;
    }

    _emergencyActive =
        false;

    return true;
  }

  bool emergencyPauseStateKnown() const override {
    return true;
  }

  bool emergencyPaused() const override {
    return _emergencyActive;
  }

private:
  bool _emergencyActive = false;
};

#else

#error "No command center firmware selected"

#endif
