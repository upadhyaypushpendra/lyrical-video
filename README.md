# LyricalVideo

LyricalVideo turns a song, lyrics, and background images into a lyric video. It uses Stable Whisper to align lyrics with the audio, a React timeline editor to adjust image timing, and Remotion to render the final video.

## Requirements

- Node.js and npm
- Python 3.10 or later
- Windows (the server invokes the Python virtual environment using Windows paths)

The first alignment downloads the Stable Whisper model and requires an internet connection.

## Setup

Install the JavaScript dependencies:

```powershell
npm install
npm install --prefix ui
```

Create the Python environment and install Stable Whisper:

```powershell
python -m venv python\.venv
python\.venv\Scripts\python.exe -m pip install --upgrade pip
python\.venv\Scripts\python.exe -m pip install stable-ts
```

## Run

Start the Express API and Vite UI:

```powershell
npm run dev
```

Open the UI at <http://localhost:5173>. Upload an MP3, background PNG/JPEG images, and lyrics, then select **Save Assets**. An optional PNG/JPEG instrumental cover appears in gaps of at least two seconds before, between, and after lyrics, including long pauses between aligned words within a lyric segment; shorter gaps continue the previous lyric clip's image. Lyrics fade out during long word-level pauses. Instrumental ranges use the same timeline controls as lyric clips: drag to move, resize either edge, replace the image, or delete; save the timeline to persist changes. Align the lyrics, edit and save the image timeline, and render the video from the corresponding workflow steps.

The API runs at <http://localhost:3333>.

## Project layout

- `ui/` — Vite and React user interface
- `server/` — Express API, uploads, and render orchestration
- `python/make-video.py` — Stable Whisper alignment pipeline
- `src/` — Remotion composition and video components
- `public/` — Remotion static files and generated alignment data

Uploaded media and generated output (including background images, audio, lyrics, timings, clips, and rendered videos) are excluded by `.gitignore`. Upload the assets again in a fresh checkout before aligning and rendering.

## Sessions

The sidebar lets you create, switch between, and delete sessions. Hover over a session and select its delete icon to remove that session and all its files after confirmation. Deleting the active session switches to another session, or creates a new **Untitled** session if none remain. A new session is also named from the uploaded song's filename (without its extension). Each session keeps its own song, lyrics, images, optional instrumental cover, alignment, lyric and instrumental timeline clips, and rendered video under `data/sessions/`. Switching sessions does not delete their files. The session data directory is local and ignored by Git.

## Other commands

```powershell
npm run studio
npm run render
npm run build --prefix ui
```

`npm run studio` opens Remotion Studio. `npm run render` renders the composition to `out/video.mp4`.
