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

Open the UI at <http://localhost:5173>. Upload an MP3, background PNG/JPEG images, and lyrics, then select **Save Assets**. Align the lyrics, edit and save the image timeline, and render the video from the corresponding workflow steps.

The API runs at <http://localhost:3333>.

## Project layout

- `ui/` — Vite and React user interface
- `server/` — Express API, uploads, and render orchestration
- `python/make-video.py` — Stable Whisper alignment pipeline
- `src/` — Remotion composition and video components
- `public/` — Remotion static files and generated alignment data

Uploaded media and generated output (including background images, audio, lyrics, timings, clips, and rendered videos) are excluded by `.gitignore`. Upload the assets again in a fresh checkout before aligning and rendering.

## Other commands

```powershell
npm run studio
npm run render
npm run build --prefix ui
```

`npm run studio` opens Remotion Studio. `npm run render` renders the composition to `out/video.mp4`.
