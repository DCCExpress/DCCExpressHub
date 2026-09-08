#pragma once

#include <Arduino.h>
#include <memory>

#include "ICommandCenter.h"

class CommandCenterFactory {
public:
  static std::unique_ptr<ICommandCenter>
  create(
      String type);

  static bool supports(
      String type);

  static String normalizeType(
      String type);
};
