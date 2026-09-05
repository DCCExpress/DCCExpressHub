# DCCExpressHub Web Installer & Serial Configurator

This directory is a static GitHub Pages application.

There is no local helper server and no local PlatformIO/esptool dependency for
end users.

The page combines:

- ESP Web Tools firmware installation
- published release selection
- local `.bin` installation
- Web Serial Hub configuration
- EX-CSB1 connection test
- minimal serial/DCC-EX console

## Hosted URL

After the release workflow deploys GitHub Pages:

```text
https://dccexpress.github.io/DCCExpressHub/
```

## Published firmware

The release workflow creates:

```text
firmware/vX.Y.Z/manifest.json
firmware/vX.Y.Z/merged-firmware.bin
releases.json
```

The installer reads `releases.json` first and falls back to GitHub Releases.

## Local firmware

Choose `Local BIN file`.

Two image types are supported:

- Factory / merged -> offset `0x000000`
- Application only -> offset `0x010000`

A temporary browser Blob URL and temporary ESP Web Tools manifest are generated
for the selected local file.

## Serial configuration

Press `Connect Hub` after the firmware is running.

The firmware protocol is line-oriented JSON with the prefix:

```text
@HUBCFG 
```

The browser stays connected in recovery mode if that protocol is not available.
