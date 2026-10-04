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
# OUTPUT DIRECTORY + FILE NAME:
#   py tools/tts.py "A személyvonat rövidesen indul." \
#       --output-dir ".\\data\\audio" \
#       --filename "szemelyvonat_indul.mp3"
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
#   output-dir  = current directory
#   filename    = bemondas.mp3
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
import sys
from pathlib import Path

import edge_tts


DEFAULT_VOICE = "hu-HU-NoemiNeural"
DEFAULT_RATE = "-8%"
DEFAULT_PITCH = "-2Hz"
DEFAULT_VOLUME = "+0%"
DEFAULT_FILENAME = "bemondas.mp3"


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
        default=".",
        help="Destination directory. Created automatically if it does not exist. Default: current directory.",
    )
    parser.add_argument(
        "-f",
        "--filename",
        default=DEFAULT_FILENAME,
        help=f"Output file name. '.mp3' is added automatically if omitted. Default: {DEFAULT_FILENAME}",
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
        "--overwrite",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )
    return parser.parse_args()


def build_output_path(output_dir: str, filename: str) -> Path:
    directory = Path(output_dir).expanduser()
    name = filename.strip()

    if not name:
        raise ValueError("Filename cannot be empty.")

    output = directory / name
    if output.suffix.lower() != ".mp3":
        output = output.with_suffix(output.suffix + ".mp3" if output.suffix else ".mp3")

    return output


async def generate(args: argparse.Namespace) -> Path:
    text = args.text.strip()
    if not text:
        raise ValueError("Text cannot be empty.")

    output = build_output_path(args.output_dir, args.filename)
    output.parent.mkdir(parents=True, exist_ok=True)

    if output.exists() and not args.overwrite:
        raise FileExistsError(
            f"Output file already exists: {output}\n"
            "Use --overwrite to replace it."
        )

    communicate = edge_tts.Communicate(
        text=text,
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
