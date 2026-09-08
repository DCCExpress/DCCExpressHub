#include "CommandCenterFactory.h"

#include "CommandCenterBuild.h"

#if defined(HUB_CC_DCCEX)
#include "DccExBridge.h"
#elif defined(HUB_CC_Z21)
#include "Z21CommandCenter.h"
#endif

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
      type ==
      CommandCenterBuild::type();
}

std::unique_ptr<ICommandCenter>
CommandCenterFactory::create(
    String type) {
  type =
      normalizeType(
          std::move(type));

  if (
      type !=
      CommandCenterBuild::type()
  ) {
    return nullptr;
  }

#if defined(HUB_CC_DCCEX)
  return
      std::unique_ptr<ICommandCenter>(
          new DccExBridge());
#else
  return
      std::unique_ptr<ICommandCenter>(
          new Z21CommandCenter());
#endif
}
