import sys
import os
from pathlib import Path

import stable_whisper

# --- Paths (all absolute, relative to this file's location) ---
HERE       = Path(__file__).parent.resolve()
SESSION_DIR = Path(os.environ.get("LYRICAL_VIDEO_SESSION_DIR", HERE)).resolve()
SONG       = SESSION_DIR / "song.mp3"
LYRICS     = SESSION_DIR / "lyrics.txt"
TIMINGS    = SESSION_DIR / "timings.json"
ASS        = SESSION_DIR / "song.ass"

LANG  = "hi"
FONT  = "Nirmala Text Semilight"
MODEL = "medium"

# --- Validate inputs exist ---
for f in [SONG, LYRICS]:
    if not f.exists():
        sys.exit(f"ERROR: Required file not found: {f}")

SESSION_DIR.mkdir(parents=True, exist_ok=True)

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
