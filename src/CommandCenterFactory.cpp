#include "CommandCenterFactory.h"

#include "DccExBridge.h"
#include "Z21CommandCenter.h"

String CommandCenterFactory::normalizeType(
    String type) {
  type.trim();
  type.toLowerCase();

  if (
      type == "dcc-ex-tcp" ||
      type == "dccex" ||
      type == "dcc_ex"
  ) {
    return "dcc-ex";
  }

  if (
      type == "roco-z21" ||
      type == "roco_z21" ||
      type == "z21-lan"
  ) {
    return "z21";
  }

  return type;
}

bool CommandCenterFactory::supports(
    String type) {
  type =
      normalizeType(
          std::move(type));

  return
      type == "dcc-ex" ||
      type == "z21";
}

std::unique_ptr<ICommandCenter>
CommandCenterFactory::create(
    String type) {
  type =
      normalizeType(
          std::move(type));

  if (
      type ==
      "dcc-ex"
  ) {
    return
        std::unique_ptr<ICommandCenter>(
            new DccExBridge());
  }

  if (
      type ==
      "z21"
  ) {
    return
        std::unique_ptr<ICommandCenter>(
            new Z21CommandCenter());
  }

  return nullptr;
}
