import sys
from pathlib import Path

import stable_whisper

# --- Paths (all absolute, relative to this file's location) ---
HERE       = Path(__file__).parent.resolve()
PUBLIC_DIR = HERE.parent / "public"
SONG       = HERE / "song.mp3"
LYRICS     = HERE / "lyrics.txt"
TIMINGS    = PUBLIC_DIR / "timings.json"
ASS        = PUBLIC_DIR / "song.ass"

LANG  = "hi"
FONT  = "Nirmala Text Semilight"
MODEL = "small"

# --- Validate inputs exist ---
for f in [SONG, LYRICS]:
    if not f.exists():
        sys.exit(f"ERROR: Required file not found: {f}")

PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

# --- 1. Load model and align lyrics to audio ---
print("Loading model...")
model = stable_whisper.load_model(MODEL)

print("Aligning lyrics...")
with open(LYRICS, encoding="utf-8") as f:
    text = f.read()

result = model.align(str(SONG), text, language=LANG, original_split=True)

# --- 2. Save outputs for Remotion ---
print(f"Saving timings to {TIMINGS}")
result.save_as_json(str(TIMINGS))

print(f"Saving subtitles to {ASS}")
result.to_ass(str(ASS), karaoke=True, font=FONT, font_size=64)

print("Done.")
