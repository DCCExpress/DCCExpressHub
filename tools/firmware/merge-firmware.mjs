import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fileURLToPath,
} from "node:url";

const scriptDir =
  path.dirname(
    fileURLToPath(import.meta.url),
  );

const repoRoot =
  path.resolve(
    scriptDir,
    "..",
    "..",
  );

function argumentValue(name) {
  const index =
    process.argv.indexOf(name);

  if (
    index < 0 ||
    index + 1 >=
      process.argv.length
  ) {
    return null;
  }

  return process.argv[
    index + 1
  ];
}

const environment =
  argumentValue("--env") ??
  "m5stack-basic";

const buildDir =
  path.join(
    repoRoot,
    ".pio",
    "build",
    environment,
  );

function requireFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Required build file not found: ${file}`,
    );
  }

  return file;
}

function readU32LE(
  buffer,
  offset,
) {
  return buffer.readUInt32LE(
    offset,
  );
}

function parsePartitionTable(
  buffer,
) {
  const entries = [];

  for (
    let offset = 0;
    offset + 32 <=
      buffer.length;
    offset += 32
  ) {
    const magic =
      buffer.readUInt16LE(
        offset,
      );

    if (magic === 0xffff) {
      break;
    }

    // ESP-IDF partition table entry magic.
    if (magic !== 0x50aa) {
      continue;
    }

    const type =
      buffer[
        offset + 2
      ];

    const subtype =
      buffer[
        offset + 3
      ];

    const partitionOffset =
      readU32LE(
        buffer,
        offset + 4,
      );

    const size =
      readU32LE(
        buffer,
        offset + 8,
      );

    const label =
      buffer
        .subarray(
          offset + 12,
          offset + 28,
        )
        .toString(
          "utf8",
        )
        .replace(
          /\0.*$/,
          "",
        );

    const flags =
      readU32LE(
        buffer,
        offset + 28,
      );

    entries.push({
      type,
      subtype,
      offset:
        partitionOffset,
      size,
      label,
      flags,
    });
  }

  return entries;
}

function findBootApp0() {
  const local =
    path.join(
      buildDir,
      "boot_app0.bin",
    );

  if (
    fs.existsSync(local)
  ) {
    return local;
  }

  const home =
    process.env.USERPROFILE ??
    os.homedir();

  const framework =
    path.join(
      home,
      ".platformio",
      "packages",
      "framework-arduinoespressif32",
      "tools",
      "partitions",
      "boot_app0.bin",
    );

  if (
    fs.existsSync(framework)
  ) {
    return framework;
  }

  throw new Error(
    "boot_app0.bin was not found in the build folder or PlatformIO Arduino-ESP32 framework.",
  );
}

const bootloaderFile =
  requireFile(
    path.join(
      buildDir,
      "bootloader.bin",
    ),
  );

const partitionsFile =
  requireFile(
    path.join(
      buildDir,
      "partitions.bin",
    ),
  );

const firmwareFile =
  requireFile(
    path.join(
      buildDir,
      "firmware.bin",
    ),
  );

const littlefsFile =
  requireFile(
    path.join(
      buildDir,
      "littlefs.bin",
    ),
  );

const bootApp0File =
  findBootApp0();

const partitionsBuffer =
  fs.readFileSync(
    partitionsFile,
  );

const partitions =
  parsePartitionTable(
    partitionsBuffer,
  );

const appPartitions =
  partitions
    .filter(
      entry =>
        entry.type === 0x00,
    )
    .sort(
      (left, right) =>
        left.offset -
        right.offset,
    );

if (
  appPartitions.length === 0
) {
  throw new Error(
    "No application partition found in partitions.bin.",
  );
}

const appPartition =
  appPartitions[0];

const filesystemPartition =
  partitions.find(
    entry =>
      entry.type === 0x01 &&
      (
        entry.subtype ===
          0x82 ||
        entry.label
          .toLowerCase()
          .includes(
            "spiffs",
          ) ||
        entry.label
          .toLowerCase()
          .includes(
            "littlefs",
          )
      ),
  );

if (!filesystemPartition) {
  throw new Error(
    "No LittleFS/SPIFFS data partition found in partitions.bin.",
  );
}

const components = [
  {
    name:
      "bootloader",
    address:
      0x1000,
    file:
      bootloaderFile,
    partitionSize:
      0x7000,
  },
  {
    name:
      "partition-table",
    address:
      0x8000,
    file:
      partitionsFile,
    partitionSize:
      0x1000,
  },
  {
    name:
      "boot-app0",
    address:
      0xe000,
    file:
      bootApp0File,
    partitionSize:
      0x2000,
  },
  {
    name:
      "application",
    address:
      appPartition.offset,
    file:
      firmwareFile,
    partitionSize:
      appPartition.size,
  },
  {
    name:
      "littlefs",
    address:
      filesystemPartition.offset,
    file:
      littlefsFile,
    partitionSize:
      filesystemPartition.size,
  },
].map(
  component => ({
    ...component,
    data:
      fs.readFileSync(
        component.file,
      ),
  }),
);

for (
  const component of
  components
) {
  if (
    component.data.length >
    component.partitionSize
  ) {
    throw new Error(
      `${component.name} image (${component.data.length} bytes) exceeds its allowed area (${component.partitionSize} bytes).`,
    );
  }
}

const sorted =
  [...components].sort(
    (left, right) =>
      left.address -
      right.address,
  );

for (
  let index = 1;
  index < sorted.length;
  index += 1
) {
  const previous =
    sorted[index - 1];

  const current =
    sorted[index];

  const previousEnd =
    previous.address +
    previous.data.length;

  if (
    previousEnd >
    current.address
  ) {
    throw new Error(
      `Merged image overlap: ${previous.name} reaches 0x${previousEnd.toString(16)}, but ${current.name} begins at 0x${current.address.toString(16)}.`,
    );
  }
}

const imageEnd =
  Math.max(
    ...components.map(
      component =>
        component.address +
        component.data.length,
    ),
  );

const merged =
  Buffer.alloc(
    imageEnd,
    0xff,
  );

for (
  const component of
  components
) {
  component.data.copy(
    merged,
    component.address,
  );
}

const outputDir =
  path.join(
    repoRoot,
    "dist",
    "firmware",
  );

fs.mkdirSync(
  outputDir,
  {
    recursive: true,
  },
);

const baseName =
  `DCCExpressHub-${environment}`;

const outputBin =
  path.join(
    outputDir,
    `${baseName}-merged.bin`,
  );

const metadataFile =
  path.join(
    outputDir,
    `${baseName}-merged.json`,
  );

fs.writeFileSync(
  outputBin,
  merged,
);

const metadata = {
  format:
    "dcc-express-hub-merged",
  version: 1,
  environment,
  flashAddress:
    "0x000000",
  factoryImage: true,
  resetsNvsWhenFlashedFromZero:
    true,
  size:
    merged.length,
  applicationPartition: {
    label:
      appPartition.label,
    address:
      `0x${appPartition.offset.toString(16)}`,
    size:
      appPartition.size,
  },
  filesystemPartition: {
    label:
      filesystemPartition.label,
    address:
      `0x${filesystemPartition.offset.toString(16)}`,
    size:
      filesystemPartition.size,
  },
  components:
    components.map(
      component => ({
        name:
          component.name,
        address:
          `0x${component.address.toString(16)}`,
        size:
          component.data.length,
        source:
          path.relative(
            repoRoot,
            component.file,
          ),
      }),
    ),
};

fs.writeFileSync(
  metadataFile,
  JSON.stringify(
    metadata,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log("");
console.log(
  "Merged firmware created:",
);
console.log(
  `  ${outputBin}`,
);
console.log(
  `  ${metadataFile}`,
);
console.log("");
console.log(
  `Application: 0x${appPartition.offset.toString(16)}`,
);
console.log(
  `LittleFS:    0x${filesystemPartition.offset.toString(16)}`,
);
console.log(
  `Image size:  ${merged.length} bytes`,
);
console.log("");
console.log(
  "IMPORTANT: this is a factory image. Flashing it from 0x000000 resets NVS configuration.",
);
