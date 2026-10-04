#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# DCCExpressHub - simple Hungarian text-to-speech helper
#
# INSTALL:
#   py -m pip install --upgrade edge-tts
#
# BASIC USAGE:
#   py tools/tts.py "A személyvonat rövidesen indul a második vágányról."
#
#   If neither --output-dir nor --filename is specified, the MP3 is written to:
#     tools/audio/A személyvonat rövidesen indul a második vágányról.mp3
#
#   The tools/audio directory is created automatically.
#   Invalid Windows filename characters are removed from auto-generated names.
#
# OUTPUT DIRECTORY + FILE NAME:
#   py tools/tts.py "A személyvonat rövidesen indul." \
#       --output-dir ".\\data\\audio" \
#       --filename "szemelyvonat_indul.mp3"
#
# OUTPUT DIRECTORY ONLY:
#   py tools/tts.py "A személyvonat rövidesen indul." \
#       --output-dir ".\\data\\audio"
#
#   In this case the spoken text is still used as the file name.
#
# PRONUNCIATION FIXES:
#   Built-in pronunciation fixes are applied only to the text sent to TTS.
#   The original text is still used for the auto-generated file name.
#
#   Example ad-hoc replacement:
#   py tools/tts.py "A személyvonat rövidesen indul a második vágányról." \
#       --replace "vágányról=vágány-ról"
#
#   --replace can be specified multiple times.
#
# MALE VOICE:
#   py tools/tts.py "A személyvonat rövidesen indul." \
#       --voice hu-HU-TamasNeural
#
# SPEECH TUNING:
#   py tools/tts.py "Kérjük, vigyázzanak, az ajtók záródnak." \
#       --rate=-10% --pitch=-2Hz --volume=+0%
#
# DEFAULTS:
#   voice       = hu-HU-NoemiNeural
#   rate        = -8%
#   pitch       = -2Hz
#   volume      = +0%
#   output-dir  = <directory containing this script>/audio
#   filename    = sanitized spoken text + .mp3
#
# NOTES:
# - No API key is required.
# - edge-tts uses Microsoft's online neural TTS service, so Internet access
#   is required while generating the audio.
# - The output format is MP3.
#
# Examples of Hungarian voices:
#   hu-HU-NoemiNeural  (female)
#   hu-HU-TamasNeural  (male)

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

import edge_tts


DEFAULT_VOICE = "hu-HU-TamasNeural"
DEFAULT_RATE = "-8%"
DEFAULT_PITCH = "-2Hz"
DEFAULT_VOLUME = "+0%"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "audio"
MAX_AUTO_FILENAME_LENGTH = 180

# Pronunciation workarounds for words the Microsoft Hungarian voice may
# pronounce incorrectly. These affect only speech generation, never file names.
PRONUNCIATION_FIXES: dict[str, str] = {
    "vágányról": "vágány-ról",
}

WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate an MP3 speech file from text using edge-tts."
    )
    parser.add_argument(
        "text",
        help="Text to speak. Put it in quotes when it contains spaces.",
    )
    parser.add_argument(
        "-d",
        "--output-dir",
        default=None,
        help=(
            "Destination directory. Created automatically if it does not exist. "
            "Default: the 'audio' directory next to this script."
        ),
    )
    parser.add_argument(
        "-f",
        "--filename",
        default=None,
        help=(
            "Output file name. '.mp3' is added automatically if omitted. "
            "Default: the spoken text, sanitized for Windows filenames."
        ),
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"edge-tts voice name. Default: {DEFAULT_VOICE}",
    )
    parser.add_argument(
        "--rate",
        default=DEFAULT_RATE,
        help=f"Speech rate, e.g. -10%% or +5%%. Default: {DEFAULT_RATE}",
    )
    parser.add_argument(
        "--pitch",
        default=DEFAULT_PITCH,
        help=f"Pitch adjustment, e.g. -2Hz or +4Hz. Default: {DEFAULT_PITCH}",
    )
    parser.add_argument(
        "--volume",
        default=DEFAULT_VOLUME,
        help=f"Volume adjustment, e.g. +0%% or -10%%. Default: {DEFAULT_VOLUME}",
    )
    parser.add_argument(
        "--replace",
        action="append",
        default=[],
        metavar="OLD=NEW",
        help=(
            "Replace text only for speech generation. Can be specified multiple "
            "times, e.g. --replace 'vágányról=vágány-ról'."
        ),
    )
    parser.add_argument(
        "--no-pronunciation-fixes",
        action="store_true",
        help="Disable built-in pronunciation fixes.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )
    return parser.parse_args()


def make_filename_from_text(text: str) -> str:
    # One line, compact whitespace.
    name = re.sub(r"\s+", " ", text).strip()

    # Windows does not allow these characters in file names.
    name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "", name)

    # Trailing dots and spaces are not valid on Windows.
    name = name.rstrip(" .")

    if not name:
        name = "bemondas"

    # Avoid Windows device names.
    if name.upper() in WINDOWS_RESERVED_NAMES:
        name = f"bemondas_{name}"

    # Keep generated names comfortably below common Windows filename limits.
    if len(name) > MAX_AUTO_FILENAME_LENGTH:
        name = name[:MAX_AUTO_FILENAME_LENGTH].rstrip(" .")

    return f"{name}.mp3"


def build_output_path(
    text: str,
    output_dir: str | None,
    filename: str | None,
) -> Path:
    directory = (
        Path(output_dir).expanduser()
        if output_dir
        else DEFAULT_OUTPUT_DIR
    )

    if filename:
        name = filename.strip()
        if not name:
            raise ValueError("Filename cannot be empty.")
        output = directory / name
        if output.suffix.lower() != ".mp3":
            output = output.with_suffix(
                output.suffix + ".mp3" if output.suffix else ".mp3"
            )
        return output

    return directory / make_filename_from_text(text)


def replace_case_insensitive(text: str, old: str, new: str) -> str:
    if not old:
        raise ValueError("Pronunciation replacement source cannot be empty.")
    return re.sub(re.escape(old), new, text, flags=re.IGNORECASE)


def parse_replacements(values: list[str]) -> list[tuple[str, str]]:
    replacements: list[tuple[str, str]] = []
    for value in values:
        if "=" not in value:
            raise ValueError(
                f"Invalid --replace value: {value!r}. Expected OLD=NEW."
            )
        old, new = value.split("=", 1)
        old = old.strip()
        new = new.strip()
        if not old:
            raise ValueError(
                f"Invalid --replace value: {value!r}. OLD cannot be empty."
            )
        replacements.append((old, new))
    return replacements


def make_speech_text(
    text: str,
    custom_replacements: list[str],
    use_builtin_fixes: bool,
) -> str:
    speech_text = text

    if use_builtin_fixes:
        for old, new in PRONUNCIATION_FIXES.items():
            speech_text = replace_case_insensitive(speech_text, old, new)

    for old, new in parse_replacements(custom_replacements):
        speech_text = replace_case_insensitive(speech_text, old, new)

    return speech_text


async def generate(args: argparse.Namespace) -> Path:
    text = args.text.strip()
    if not text:
        raise ValueError("Text cannot be empty.")

    speech_text = make_speech_text(
        text,
        args.replace,
        use_builtin_fixes=not args.no_pronunciation_fixes,
    )

    output = build_output_path(text, args.output_dir, args.filename)
    output.parent.mkdir(parents=True, exist_ok=True)

    if output.exists() and not args.overwrite:
        raise FileExistsError(
            f"Output file already exists: {output}\n"
            "Use --overwrite to replace it."
        )

    if speech_text != text:
        print(f"TTS text: {speech_text}")

    communicate = edge_tts.Communicate(
        text=speech_text,
        voice=args.voice,
        rate=args.rate,
        pitch=args.pitch,
        volume=args.volume,
    )
    await communicate.save(str(output))
    return output.resolve()


def main() -> int:
    args = parse_args()

    try:
        output = asyncio.run(generate(args))
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"Created: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
