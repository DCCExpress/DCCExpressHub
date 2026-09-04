# DCCExpressLite web UI

This directory contains the complete web UI source embedded in the EX-CSB1 firmware. All application code lives under `src/`; it is self-contained and does not require the DCCExpressNext repository.

```powershell
npm install
npm run dev
npm run embed
```

`npm run embed` type-checks and builds the UI, then writes the compressed production assets into `../data/` for the LittleFS firmware image.
