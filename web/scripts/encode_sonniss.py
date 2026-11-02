#!/usr/bin/env python3
"""Turn a folder of broadcast WAVs into short web sound effects.

Each source becomes a 96 kbps Vorbis .ogg (Chromium, Firefox) and a 96 kbps
AAC .m4a (Safari). Leading silence is removed, the take is cut to
MAX_DURATION, and a short fade-out closes the cut so it does not click.
Loudness is then brought to -16 LUFS. Clips that are too short for loudnorm
fall back to a peak normalize.

Run from anywhere:

    python web/scripts/encode_sonniss.py
    python web/scripts/encode_sonniss.py --workers 2 --force

Windows prerequisite: ffmpeg and ffprobe on PATH, including the libvorbis
encoder and the built-in aac encoder. A full Gyan build has both:

    winget install Gyan.FFmpeg

Open a new terminal after installing, then check `ffmpeg -version`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

# --- tweak these -----------------------------------------------------------

INPUT_DIR = Path(r"C:\Users\sammu\Downloads\axis assets\audio")
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "audio"

MAX_DURATION = 2.5
FADE_OUT_DURATION = 0.2

# -16 LUFS sits louder than broadcast (-23) and stays even across one-shots.
# linear=true is a single gain, so the fade and the transient stay put.
TARGET_I = -16.0
TARGET_TP = -1.5
TARGET_LRA = 11.0
BITRATE = "96k"
SAMPLE_RATE = "48000"
CHANNELS = "2"

# Leading dead air only. Duration 0 stops at the first sample above the
# threshold, so the attack of a one-shot is left intact. Window is how long
# a sample has to look like silence before it counts.
SILENCE_THRESHOLD = "-50dB"
SILENCE_DURATION = 0
SILENCE_WINDOW = 0.005

# A result shorter than this means the silence filter ate the take.
MIN_AUDIBLE = 0.02

PRINT_LOCK = Lock()


def log(message: str) -> None:
    with PRINT_LOCK:
        print(message, flush=True)


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass


def require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise SystemExit(
            "ffmpeg and ffprobe were not found on PATH.\n"
            "Install a full build, then open a new terminal:\n"
            "    winget install Gyan.FFmpeg\n"
            "Check with: ffmpeg -version"
        )
    encoders = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout
    missing = [name for name in ("libvorbis", "aac") if name not in encoders]
    if missing:
        raise SystemExit(
            "This ffmpeg build is missing encoders: "
            + ", ".join(missing)
            + ".\nInstall the full Gyan build (winget install Gyan.FFmpeg), "
            "not a stripped LGPL build that omits libvorbis."
        )


def run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def tail(stderr: str, lines: int = 12) -> str:
    kept = [line for line in stderr.splitlines() if line.strip()]
    return "\n".join(kept[-lines:])


def seconds(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def probe_duration(path: Path) -> float | None:
    result = run_ffmpeg(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ]
    )
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def duration_seconds(path: Path) -> float:
    measured = probe_duration(path)
    if measured is None:
        raise RuntimeError(f"ffprobe returned no duration for {path.name}")
    return measured


def cut_filter(strip_silence: bool) -> str:
    parts: list[str] = []
    if strip_silence:
        parts.append(
            "silenceremove="
            "start_periods=1:"
            f"start_duration={seconds(SILENCE_DURATION)}:"
            f"start_threshold={SILENCE_THRESHOLD}:"
            "detection=peak:"
            f"window={seconds(SILENCE_WINDOW)}"
        )
    # atrim reads timestamps after the silence filter, so the cap is the first
    # MAX_DURATION of remaining audio, not the first MAX_DURATION of the file.
    parts.append(f"atrim=start=0:end={seconds(MAX_DURATION)}")
    parts.append("asetpts=PTS-STARTPTS")
    return ",".join(parts)


def render_wav(source: Path, dest: Path, audio_filter: str) -> None:
    result = run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-vn",
            "-ac",
            CHANNELS,
            "-ar",
            SAMPLE_RATE,
            "-af",
            audio_filter,
            "-map_metadata",
            "-1",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            str(dest),
        ]
    )
    if result.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise RuntimeError(tail(result.stderr) or f"{dest.name} was empty")


def trim_to_wav(source: Path, dest: Path) -> None:
    render_wav(source, dest, cut_filter(strip_silence=True))
    # An all-silent take can leave a header with no duration. Treat that as
    # "the filter ate the file" and keep the capped original instead.
    if (probe_duration(dest) or 0.0) >= MIN_AUDIBLE:
        return
    render_wav(source, dest, cut_filter(strip_silence=False))
    if (probe_duration(dest) or 0.0) < MIN_AUDIBLE:
        raise RuntimeError("no audio left after trimming")


def fade_out(source: Path, dest: Path) -> float:
    length = duration_seconds(source)
    if length < MIN_AUDIBLE:
        raise RuntimeError("trimmed audio is empty")
    # Clips shorter than twice the fade keep half their length unfaded,
    # so a 0.2s fade cannot mute a short click.
    fade = min(FADE_OUT_DURATION, length / 2)
    if fade < 0.005:
        shutil.copyfile(source, dest)
        return length
    start = length - fade
    render_wav(
        source,
        dest,
        f"afade=t=out:st={start:.6f}:d={fade:.6f}",
    )
    return length


def measure_loudnorm(path: Path) -> dict[str, str] | None:
    result = run_ffmpeg(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
            "-f",
            "null",
            "-",
        ]
    )
    start = result.stderr.rfind("{")
    end = result.stderr.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        measured = json.loads(result.stderr[start : end + 1])
    except json.JSONDecodeError:
        return None
    needed = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")
    if any(key not in measured for key in needed):
        return None
    if any(str(measured[key]).lower() in {"-inf", "inf", "nan"} for key in needed):
        return None
    return {key: str(measured[key]) for key in needed}


def peak_gain(path: Path) -> str:
    result = run_ffmpeg(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ]
    )
    match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?) dB", result.stderr)
    if match is None:
        return "volume=0dB"
    gain = TARGET_TP - float(match.group(1))
    return f"volume={gain:.2f}dB"


def loudness_filter(path: Path) -> str:
    measured = measure_loudnorm(path)
    if measured is None:
        return peak_gain(path)
    return (
        "loudnorm="
        f"I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
        f"measured_I={measured['input_i']}:"
        f"measured_TP={measured['input_tp']}:"
        f"measured_LRA={measured['input_lra']}:"
        f"measured_thresh={measured['input_thresh']}:"
        f"offset={measured['target_offset']}:"
        "linear=true"
    )


def encode(source: Path, dest: Path, audio_filter: str, codec: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-nostats",
        "-i",
        str(source),
        "-af",
        audio_filter,
        "-map_metadata",
        "-1",
        "-c:a",
        codec,
        "-b:a",
        BITRATE,
        "-ar",
        SAMPLE_RATE,
        "-ac",
        CHANNELS,
    ]
    if codec == "aac":
        args.extend(["-movflags", "+faststart"])
    args.append(str(dest))
    result = run_ffmpeg(args)
    if result.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise RuntimeError(tail(result.stderr) or f"{dest.name} was empty")


def kb(path: Path) -> str:
    return f"{path.stat().st_size / 1024:.0f} KB"


def process_one(
    source: Path,
    destination_dir: Path,
    source_root: Path,
    index: int,
    total: int,
    force: bool,
) -> str:
    # Replace only the final ".wav". A second with_suffix() would treat
    # ".56mm_..." or ".45ACP_..." inside the name as the extension.
    relative = source.relative_to(source_root)
    ogg = (destination_dir / relative).with_suffix(".ogg")
    m4a = (destination_dir / relative).with_suffix(".m4a")
    label = relative.as_posix()

    if (
        not force
        and ogg.exists()
        and m4a.exists()
        and ogg.stat().st_size > 0
        and m4a.stat().st_size > 0
    ):
        log(f"[{index}/{total}] skip  {label}")
        return "skip"

    log(f"[{index}/{total}] start {label}")
    with tempfile.TemporaryDirectory(prefix="sonniss-") as temp_dir:
        temp = Path(temp_dir)
        trimmed = temp / "trimmed.wav"
        faded = temp / "faded.wav"
        trim_to_wav(source, trimmed)
        length = fade_out(trimmed, faded)
        audio_filter = loudness_filter(faded)
        encode(faded, ogg, audio_filter, "libvorbis")
        encode(faded, m4a, audio_filter, "aac")
    log(f"[{index}/{total}] done  {label}  {length:.2f}s  ogg {kb(ogg)}  m4a {kb(m4a)}")
    return "ok"


def collect_wavs(folder: Path) -> list[Path]:
    files = [
        path
        for path in folder.rglob("*")
        if path.is_file() and path.suffix.lower() == ".wav"
    ]
    return sorted(files, key=lambda path: str(path).lower())


def output_is_inside_input(source_root: Path, destination: Path) -> bool:
    try:
        destination.relative_to(source_root)
    except ValueError:
        return False
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Trim, normalize, and encode Sonniss WAVs to web ogg and m4a."
    )
    parser.add_argument("--input", type=Path, default=INPUT_DIR, help="Folder of .wav files")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR, help="Destination folder")
    parser.add_argument(
        "--workers",
        type=int,
        default=min(2, os.cpu_count() or 1),
        help="Parallel ffmpeg jobs. Keep this low for large broadcast WAVs.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-encode even when both outputs already exist",
    )
    return parser.parse_args()


def main() -> int:
    configure_stdio()
    args = parse_args()
    source_root = args.input.expanduser().resolve()
    destination = args.output.expanduser().resolve()

    if MAX_DURATION <= 0:
        print("MAX_DURATION must be greater than 0", file=sys.stderr)
        return 1
    if FADE_OUT_DURATION < 0:
        print("FADE_OUT_DURATION cannot be negative", file=sys.stderr)
        return 1
    if not source_root.is_dir():
        print(f"Input directory does not exist: {source_root}", file=sys.stderr)
        return 1
    if args.workers < 1:
        print("--workers must be at least 1", file=sys.stderr)
        return 1
    if output_is_inside_input(source_root, destination):
        print("Output directory must not sit inside the input directory.", file=sys.stderr)
        return 1

    require_ffmpeg()
    wavs = collect_wavs(source_root)
    if not wavs:
        print(f"No .wav files under {source_root}")
        return 1

    destination.mkdir(parents=True, exist_ok=True)
    print(f"Input    {source_root}")
    print(f"Output   {destination}")
    print(f"Files    {len(wavs)}")
    print(f"Workers  {args.workers}")
    print(
        f"Encode   max {seconds(MAX_DURATION)}s, "
        f"fade {seconds(FADE_OUT_DURATION)}s, "
        f"ogg + m4a at {BITRATE}, {SAMPLE_RATE} Hz, {TARGET_I:g} LUFS"
    )

    counts = {"ok": 0, "skip": 0, "fail": 0}
    failures: list[str] = []
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                process_one,
                path,
                destination,
                source_root,
                index,
                len(wavs),
                args.force,
            ): path
            for index, path in enumerate(wavs, start=1)
        }
        for future in as_completed(futures):
            source = futures[future]
            try:
                counts[future.result()] += 1
            except Exception as error:
                counts["fail"] += 1
                message = f"{source.name}: {error}"
                failures.append(message)
                log(f"FAIL  {message}")

    elapsed = time.perf_counter() - started
    print("")
    print(
        f"Finished  ok {counts['ok']}  skipped {counts['skip']}  "
        f"failed {counts['fail']}  {elapsed:.1f}s"
    )
    for message in failures:
        print(f"  {message}", file=sys.stderr)
    return 1 if counts["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
