DCCExpressHub VERSION + DCC-EX-only release setup

Current policy:
- DCC-EX is the official / primary backend.
- GitHub Releases publish ONLY:
    * M5Stack Basic / DCC-EX
    * ESP32 DevKit / DCC-EX
- Z21 source code and PlatformIO targets stay in the repository.
- README mentions Z21 only as planned future support.
- No official Z21 firmware is released.

Install / update:
  .\setup-versioning.ps1 -RepoRoot D:\MyProjects\DCCExpressHub

Then:
  cd D:\MyProjects\DCCExpressHub
  git diff

Commit/push the migration normally.

Next release example:
  .\release.ps1 0.1.0-alpha.2

VERSION is authoritative.
Pushing a matching v* tag starts GitHub Actions.
