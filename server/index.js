const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const PORT = 3333;
const ROOT_DIR   = path.join(__dirname, "..");
const PYTHON_DIR = path.join(ROOT_DIR, "python");
const SESSIONS_DIR = path.join(ROOT_DIR, "data", "sessions");
const ACTIVE_SESSION_PATH = path.join(SESSIONS_DIR, "active.json");
const VIDEO_DURATION_SECONDS = 160;
const MIN_INSTRUMENTAL_DURATION_SECONDS = 2;
app.use(express.static(path.join(__dirname, "../ui/dist")));
app.use(express.json());

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function sessionDir(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid session id");
  return path.join(SESSIONS_DIR, id);
}

function isSessionId(id) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function readSession(id) {
  const dir = sessionDir(id);
  const metadataPath = path.join(dir, "session.json");
  if (!fs.existsSync(metadataPath)) return null;
  return JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
}

function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(sessionDir(session.id), "session.json"), JSON.stringify(session, null, 2));
}

function createSession() {
  const id = crypto.randomUUID();
  const dir = sessionDir(id);
  fs.mkdirSync(path.join(dir, "bg"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bg-images.json"), JSON.stringify([]));
  fs.writeFileSync(path.join(dir, "cover-image.json"), JSON.stringify(null));
  fs.writeFileSync(path.join(dir, "instrumental-clips.json"), JSON.stringify([]));
  fs.writeFileSync(path.join(dir, "pipeline.log"), "");
  const now = new Date().toISOString();
  const session = {
    id,
    name: "Untitled",
    createdAt: now,
    updatedAt: now,
    pipelineStatus: "idle",
    pipelineStage: null,
    clipsSaved: false,
  };
  saveSession(session);
  return session;
}

let activeSessionId = null;
if (fs.existsSync(ACTIVE_SESSION_PATH)) {
  const saved = JSON.parse(fs.readFileSync(ACTIVE_SESSION_PATH, "utf-8"));
  if (isSessionId(saved.id) && readSession(saved.id)) activeSessionId = saved.id;
}
if (!activeSessionId) {
  const existingSessions = fs.readdirSync(SESSIONS_DIR)
    .filter(isSessionId)
    .map((name) => readSession(name))
    .filter(Boolean);
  const initialSession = existingSessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? createSession();
  activeSessionId = initialSession.id;
  fs.writeFileSync(ACTIVE_SESSION_PATH, JSON.stringify({ id: activeSessionId }));
}

function getActiveSession() {
  const session = readSession(activeSessionId);
  if (!session) throw new Error("The active session could not be found");
  return session;
}

function getSessionPaths(session) {
  const dir = sessionDir(session.id);
  return {
    dir,
    song: path.join(dir, "song.mp3"),
    lyrics: path.join(dir, "lyrics.txt"),
    bgDir: path.join(dir, "bg"),
    timings: path.join(dir, "timings.json"),
    subtitles: path.join(dir, "song.ass"),
    clips: path.join(dir, "clips.json"),
    instrumentalClips: path.join(dir, "instrumental-clips.json"),
    video: path.join(dir, "video.mp4"),
    bgImages: path.join(dir, "bg-images.json"),
    coverImageManifest: path.join(dir, "cover-image.json"),
    pipelineLog: path.join(dir, "pipeline.log"),
  };
}

function getCoverImageName(session) {
  return fs.readdirSync(getSessionPaths(session).dir).find((name) => /^cover\.(png|jpe?g)$/i.test(name)) ?? null;
}

function listImageNames(session) {
  return fs.readdirSync(getSessionPaths(session).bgDir).filter((name) => /\.(png|jpe?g)$/i.test(name));
}

function updateImageManifest(session) {
  fs.writeFileSync(getSessionPaths(session).bgImages, JSON.stringify(listImageNames(session)));
}

function updateCoverImageManifest(session) {
  fs.writeFileSync(getSessionPaths(session).coverImageManifest, JSON.stringify(getCoverImageName(session)));
}

function getLegacyInstrumentalClipsForMinimumDuration(session, minimumDuration) {
  const paths = getSessionPaths(session);
  if (!fs.existsSync(paths.timings)) return [];
  const segments = JSON.parse(fs.readFileSync(paths.timings, "utf-8")).segments ?? [];
  const ranges = [];
  let cursor = 0;
  for (let slot = 0; slot <= segments.length; slot++) {
    const segment = segments[slot];
    const boundary = segment?.start ?? VIDEO_DURATION_SECONDS;
    if (boundary - cursor >= minimumDuration) {
      ranges.push({ id: ranges.length, slot, start: cursor, end: boundary });
    }
    if (segment) {
      const lastWordEnd = segment.words?.[segment.words.length - 1]?.end;
      cursor = Math.max(cursor, typeof lastWordEnd === "number" ? lastWordEnd : segment.end);
    }
  }
  return ranges;
}

function getTimelineDefaults(session, minimumInstrumentalDuration = MIN_INSTRUMENTAL_DURATION_SECONDS) {
  const paths = getSessionPaths(session);
  if (!fs.existsSync(paths.timings)) return { clips: [], instrumentalClips: [] };

  const segments = JSON.parse(fs.readFileSync(paths.timings, "utf-8")).segments ?? [];
  const images = listImageNames(session);
  const clips = [];
  const instrumentalClips = [];
  let cursor = 0;

  const addInstrumentalClip = (start, end) => {
    if (end - start < minimumInstrumentalDuration) return;
    instrumentalClips.push({
      id: instrumentalClips.length,
      slot: clips.length,
      start,
      end,
    });
  };

  const addLyricClip = (segment, segmentIndex, start, end) => {
    if (end <= start) return;
    clips.push({
      id: clips.length,
      image: images.length ? images[segmentIndex % images.length] : null,
      start,
      end,
      label: segment.text.trim(),
    });
  };

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (segment.start > cursor) {
      if (segment.start - cursor >= minimumInstrumentalDuration) {
        addInstrumentalClip(cursor, segment.start);
      } else if (clips.length) {
        clips[clips.length - 1].end = segment.start;
      }
    }

    const words = (Array.isArray(segment.words) ? segment.words : [])
      .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
    if (!words.length) {
      addLyricClip(segment, segmentIndex, segment.start, segment.end);
      cursor = Math.max(cursor, segment.end);
      continue;
    }

    let clipStart = segment.start;
    if (words[0].start - clipStart >= minimumInstrumentalDuration) {
      addInstrumentalClip(clipStart, words[0].start);
      clipStart = words[0].start;
    }

    let previousWord = words[0];
    for (const word of words.slice(1)) {
      if (word.start - previousWord.end >= minimumInstrumentalDuration) {
        addLyricClip(segment, segmentIndex, clipStart, previousWord.end);
        addInstrumentalClip(previousWord.end, word.start);
        clipStart = word.start;
      }
      previousWord = word;
    }

    addLyricClip(segment, segmentIndex, clipStart, previousWord.end);
    cursor = Math.max(cursor, previousWord.end);
  }

  if (VIDEO_DURATION_SECONDS - cursor >= minimumInstrumentalDuration) {
    addInstrumentalClip(cursor, VIDEO_DURATION_SECONDS);
  } else if (clips.length) {
    clips[clips.length - 1].end = VIDEO_DURATION_SECONDS;
  }

  return { clips, instrumentalClips };
}

function getDefaultInstrumentalClips(session) {
  return getTimelineDefaults(session).instrumentalClips;
}

function hasDefaultInstrumentalClips(session) {
  const file = getSessionPaths(session).instrumentalClips;
  if (!fs.existsSync(file)) return false;
  const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
  return [0.5, MIN_INSTRUMENTAL_DURATION_SECONDS].some((minimumDuration) => {
    const previousDefaults = getLegacyInstrumentalClipsForMinimumDuration(session, minimumDuration);
    return saved.length === previousDefaults.length && saved.every((clip, index) =>
      clip.slot === previousDefaults[index].slot
      && Math.abs(clip.start - previousDefaults[index].start) < 0.001
      && Math.abs(clip.end - previousDefaults[index].end) < 0.001
      && (clip.image === undefined || clip.image === null || clip.image === "cover")
    );
  });
}

function readInstrumentalClips(session) {
  const file = getSessionPaths(session).instrumentalClips;
  if (!fs.existsSync(file)) return getDefaultInstrumentalClips(session);
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function saveDefaultInstrumentalClips(session) {
  fs.writeFileSync(getSessionPaths(session).instrumentalClips, JSON.stringify(getDefaultInstrumentalClips(session), null, 2));
}

for (const name of fs.readdirSync(SESSIONS_DIR).filter(isSessionId)) {
  const session = readSession(name);
  if (!session) continue;
  const paths = getSessionPaths(session);
  fs.mkdirSync(paths.bgDir, { recursive: true });
  if (!fs.existsSync(paths.bgImages)) updateImageManifest(session);
  if (!fs.existsSync(paths.coverImageManifest)) updateCoverImageManifest(session);
  if (!fs.existsSync(paths.instrumentalClips) || !session.clipsSaved || hasDefaultInstrumentalClips(session)) {
    saveDefaultInstrumentalClips(session);
  }
  if (!fs.existsSync(paths.pipelineLog)) fs.writeFileSync(paths.pipelineLog, "");
}

function sessionSummary(session) {
  const paths = getSessionPaths(session);
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    pipelineStatus: session.pipelineStatus,
    pipelineStage: session.pipelineStage,
    clipsSaved: session.clipsSaved,
    hasSong: fs.existsSync(paths.song),
    imageCount: listImageNames(session).length,
  };
}

let runningSessionId = null;
let activeUploads = 0;

function preventSessionChangesDuringPipeline(req, res, next) {
  if (runningSessionId || activeUploads) {
    return res.status(409).json({ error: "Cannot change session assets while an operation is running" });
  }
  next();
}

app.get("/api/sessions", (req, res) => {
  const sessions = fs.readdirSync(SESSIONS_DIR)
    .filter(isSessionId)
    .map((name) => readSession(name))
    .filter(Boolean)
    .map(sessionSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ sessions, activeSessionId });
});

app.post("/api/sessions", (req, res) => {
  if (runningSessionId || activeUploads) return res.status(409).json({ error: "Cannot create a session while an operation is running" });
  const session = createSession();
  activeSessionId = session.id;
  fs.writeFileSync(ACTIVE_SESSION_PATH, JSON.stringify({ id: activeSessionId }));
  res.status(201).json({ session: sessionSummary(session), activeSessionId });
});

app.post("/api/sessions/:id/activate", (req, res) => {
  if (runningSessionId || activeUploads) return res.status(409).json({ error: "Cannot switch sessions while an operation is running" });
  if (!isSessionId(req.params.id)) return res.status(400).json({ error: "Invalid session id" });
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  activeSessionId = session.id;
  fs.writeFileSync(ACTIVE_SESSION_PATH, JSON.stringify({ id: activeSessionId }));
  res.json({ session: sessionSummary(session), activeSessionId });
});

app.delete("/api/sessions/:id", (req, res) => {
  if (runningSessionId || activeUploads) return res.status(409).json({ error: "Cannot delete a session while an operation is running" });
  if (!isSessionId(req.params.id)) return res.status(400).json({ error: "Invalid session id" });
  const session = readSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  fs.rmSync(sessionDir(session.id), { recursive: true });
  activeSessionId = createSession().id;
  fs.writeFileSync(ACTIVE_SESSION_PATH, JSON.stringify({ id: activeSessionId }));

  res.json({ ok: true, activeSessionId });
});

function attachActiveSession(req, res, next) {
  try {
    req.session = getActiveSession();
    req.sessionPaths = getSessionPaths(req.session);
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(req.sessionPaths.bgDir, { recursive: true });
    cb(null, file.fieldname === "images" ? req.sessionPaths.bgDir : req.sessionPaths.dir);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === "song") cb(null, "song.mp3");
    else if (file.fieldname === "coverImage") cb(null, `cover${path.extname(file.originalname).toLowerCase()}`);
    else cb(null, path.basename(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (["images", "coverImage"].includes(file.fieldname) && !/\.(png|jpe?g)$/i.test(file.originalname)) {
      cb(new Error("Only PNG and JPEG images are supported."));
      return;
    }
    cb(null, true);
  },
});

app.post("/api/upload", attachActiveSession, preventSessionChangesDuringPipeline, (req, res, next) => {
  activeUploads += 1;
  upload.fields([
    { name: "song", maxCount: 1 },
    { name: "images", maxCount: 50 },
    { name: "coverImage", maxCount: 1 },
  ])(req, res, (err) => {
    activeUploads -= 1;
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  const lyrics = typeof req.body.lyrics === "string" ? req.body.lyrics : "";
  const previousLyrics = fs.existsSync(req.sessionPaths.lyrics)
    ? fs.readFileSync(req.sessionPaths.lyrics, "utf-8")
    : "";
  const lyricsChanged = previousLyrics !== lyrics;
  fs.writeFileSync(req.sessionPaths.lyrics, lyrics, "utf-8");
  const song = req.files?.song?.[0];
  const coverImage = req.files?.coverImage?.[0];
  if (song || lyricsChanged) {
    if (song) req.session.name = path.parse(song.originalname).name || "Untitled";
    [req.sessionPaths.timings, req.sessionPaths.subtitles, req.sessionPaths.clips, req.sessionPaths.video]
      .forEach((file) => { if (fs.existsSync(file)) fs.unlinkSync(file); });
    req.session.pipelineStatus = "idle";
    req.session.pipelineStage = null;
    fs.writeFileSync(req.sessionPaths.pipelineLog, "");
    req.session.clipsSaved = false;
  } else if (req.files?.images?.length || coverImage) {
    if (fs.existsSync(req.sessionPaths.video)) fs.unlinkSync(req.sessionPaths.video);
    if (req.session.pipelineStatus === "done" || (req.session.pipelineStatus === "error" && req.session.pipelineStage === "render")) {
      req.session.pipelineStatus = "aligned";
      req.session.pipelineStage = "align";
    }
  }
  if (coverImage) {
    fs.readdirSync(req.sessionPaths.dir)
      .filter((name) => /^cover\.(png|jpe?g)$/i.test(name) && name !== coverImage.filename)
      .forEach((name) => fs.unlinkSync(path.join(req.sessionPaths.dir, name)));
  }
  updateImageManifest(req.session);
  updateCoverImageManifest(req.session);
  saveSession(req.session);
  res.json({ ok: true, session: sessionSummary(req.session) });
});

app.get("/api/assets", attachActiveSession, (req, res) => {
  const images = listImageNames(req.session);
  const hasSong = fs.existsSync(req.sessionPaths.song);
  const lyrics = fs.existsSync(req.sessionPaths.lyrics) ? fs.readFileSync(req.sessionPaths.lyrics, "utf-8") : "";
  res.json({
    hasSong,
    images,
    lyrics,
    coverImage: getCoverImageName(req.session),
    sessionId: req.session.id,
    sessionName: req.session.name,
  });
});

app.get("/api/cover-image", attachActiveSession, (req, res) => {
  const filename = getCoverImageName(req.session);
  if (!filename) return res.status(404).json({ error: "No cover image uploaded" });
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(req.sessionPaths.dir, filename));
});

app.delete("/api/cover-image", attachActiveSession, preventSessionChangesDuringPipeline, (req, res) => {
  const filename = getCoverImageName(req.session);
  if (filename) fs.unlinkSync(path.join(req.sessionPaths.dir, filename));
  updateCoverImageManifest(req.session);
  if (fs.existsSync(req.sessionPaths.video)) fs.unlinkSync(req.sessionPaths.video);
  if (req.session.pipelineStatus === "done" || (req.session.pipelineStatus === "error" && req.session.pipelineStage === "render")) {
    req.session.pipelineStatus = fs.existsSync(req.sessionPaths.timings) ? "aligned" : "idle";
    req.session.pipelineStage = fs.existsSync(req.sessionPaths.timings) ? "align" : null;
  }
  saveSession(req.session);
  res.json({ ok: true });
});

app.get("/api/image/:filename", attachActiveSession, (req, res) => {
  const filename = req.params.filename;
  if (path.basename(filename) !== filename || !/\.(png|jpe?g)$/i.test(filename)) {
    return res.status(400).json({ error: "Invalid image filename" });
  }
  const imagePath = path.join(req.sessionPaths.bgDir, filename);
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: "Image not found" });
  res.sendFile(imagePath);
});

app.delete("/api/image/:filename", attachActiveSession, preventSessionChangesDuringPipeline, (req, res) => {
  const filename = req.params.filename;
  if (path.basename(filename) !== filename) return res.status(400).json({ error: "Invalid image filename" });
  const file = path.join(req.sessionPaths.bgDir, filename);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    if (fs.existsSync(req.sessionPaths.video)) fs.unlinkSync(req.sessionPaths.video);
    if (fs.existsSync(req.sessionPaths.clips)) {
      const clips = JSON.parse(fs.readFileSync(req.sessionPaths.clips, "utf-8"));
      const updatedClips = clips.map((clip) => clip.image === filename ? { ...clip, image: null } : clip);
      if (updatedClips.some((clip, index) => clip.image !== clips[index].image)) {
        fs.writeFileSync(req.sessionPaths.clips, JSON.stringify(updatedClips, null, 2));
        req.session.clipsSaved = false;
      }
    }
    if (req.session.pipelineStatus === "done") {
      req.session.pipelineStatus = fs.existsSync(req.sessionPaths.timings) ? "aligned" : "idle";
      req.session.pipelineStage = fs.existsSync(req.sessionPaths.timings) ? "align" : null;
    }
    saveSession(req.session);
  }
  updateImageManifest(req.session);
  res.json({ ok: true });
});

// --- Pipeline state ---
// status: idle | aligning | aligned | rendering | done | error
for (const name of fs.readdirSync(SESSIONS_DIR).filter(isSessionId)) {
  const session = readSession(name);
  if (session && ["aligning", "rendering"].includes(session.pipelineStatus)) {
    session.pipelineStatus = "error";
    fs.appendFileSync(getSessionPaths(session).pipelineLog, "\nPipeline interrupted when the server stopped.\n");
    saveSession(session);
  }
}

function appendPipelineLog(session, text) {
  fs.appendFileSync(getSessionPaths(session).pipelineLog, text);
  process.stdout.write(text);
}

function runCommand(cmd, args, cwd, session, env = process.env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true, env });
    proc.stdout.on("data", (d) => appendPipelineLog(session, d.toString()));
    proc.stderr.on("data", (d) => appendPipelineLog(session, d.toString()));
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Exited with code ${code}`)));
    proc.on("error", reject);
  });
}

// Step 1 — Align lyrics
app.post("/api/align", attachActiveSession, async (req, res) => {
  const session = req.session;
  const paths = req.sessionPaths;
  if (runningSessionId || activeUploads) return res.status(409).json({ error: "A pipeline or upload is already running" });
  if (!fs.existsSync(paths.song) || !fs.existsSync(paths.lyrics) || listImageNames(session).length === 0) {
    return res.status(400).json({ error: "Upload a song, lyrics, and at least one image before aligning" });
  }
  runningSessionId = session.id;
  fs.writeFileSync(paths.pipelineLog, "");
  session.pipelineStage = "align";
  session.pipelineStatus = "aligning";
  session.clipsSaved = false;
  saveSession(session);
  res.json({ ok: true });
  try {
    appendPipelineLog(session, "Aligning lyrics to audio...\n");
    const env = { ...process.env, LYRICAL_VIDEO_SESSION_DIR: paths.dir };
    await runCommand(".venv\\Scripts\\python", ["make-video.py"], PYTHON_DIR, session, env);
    if (fs.existsSync(paths.clips)) fs.unlinkSync(paths.clips);
    saveDefaultInstrumentalClips(session);
    session.clipsSaved = false;
    session.pipelineStatus = "aligned";
    appendPipelineLog(session, "✅ Alignment complete. Edit the timeline and render.\n");
  } catch (err) {
    session.pipelineStatus = "error";
    appendPipelineLog(session, `❌ ${err.message}\n`);
  } finally {
    runningSessionId = null;
    saveSession(session);
  }
});

// Step 2 — Render video
app.post("/api/render", attachActiveSession, async (req, res) => {
  const session = req.session;
  const paths = req.sessionPaths;
  if (runningSessionId || activeUploads) return res.status(409).json({ error: "A pipeline or upload is already running" });
  if (!session.clipsSaved || !fs.existsSync(paths.song) || !fs.existsSync(paths.timings)) {
    return res.status(400).json({ error: "Align lyrics and save the timeline before rendering" });
  }
  runningSessionId = session.id;
  fs.writeFileSync(paths.pipelineLog, "");
  session.pipelineStage = "render";
  session.pipelineStatus = "rendering";
  saveSession(session);
  res.json({ ok: true });
  try {
    appendPipelineLog(session, "Rendering video with Remotion...\n");
    await runCommand("npx", [
      "remotion", "render", "src/index.ts", "LyricalVideo", paths.video,
      "--public-dir", paths.dir, "--overwrite",
    ], ROOT_DIR, session);
    session.pipelineStatus = "done";
    appendPipelineLog(session, "✅ Video rendered successfully.\n");
  } catch (err) {
    session.pipelineStatus = "error";
    appendPipelineLog(session, `❌ ${err.message}\n`);
  } finally {
    runningSessionId = null;
    saveSession(session);
  }
});

app.get("/api/pipeline/status", attachActiveSession, (req, res) => {
  res.json({
    status: req.session.pipelineStatus,
    stage: req.session.pipelineStage,
    log: fs.existsSync(req.sessionPaths.pipelineLog) ? fs.readFileSync(req.sessionPaths.pipelineLog, "utf-8") : "",
  });
});

// --- Clips ---
app.get("/api/clips", attachActiveSession, (req, res) => {
  const paths = req.sessionPaths;
  if (req.session.clipsSaved && fs.existsSync(paths.clips)) {
    return res.json(JSON.parse(fs.readFileSync(paths.clips, "utf-8")));
  }
  const { clips } = getTimelineDefaults(req.session);
  fs.writeFileSync(paths.clips, JSON.stringify(clips, null, 2));
  res.json(clips);
});

app.get("/api/instrumental-clips", attachActiveSession, (req, res) => {
  res.json(readInstrumentalClips(req.session));
});

app.post("/api/clips", attachActiveSession, preventSessionChangesDuringPipeline, (req, res) => {
  const clips = Array.isArray(req.body) ? req.body : req.body?.clips;
  const instrumentalClips = Array.isArray(req.body) ? undefined : req.body?.instrumentalClips;
  if (!Array.isArray(clips)) return res.status(400).json({ error: "Clips must be an array" });
  if (instrumentalClips !== undefined && (
    !Array.isArray(instrumentalClips)
    || instrumentalClips.some((clip) =>
      !clip
      || !Number.isInteger(clip.slot)
      || clip.slot < 0
      || clip.slot > clips.length
      || !Number.isFinite(clip.start)
      || !Number.isFinite(clip.end)
      || clip.start < 0
      || clip.end > VIDEO_DURATION_SECONDS
      || clip.end - clip.start < 0.5
      || clip.start < (clip.slot > 0 ? clips[clip.slot - 1]?.end ?? 0 : 0)
      || clip.end > (clips[clip.slot]?.start ?? VIDEO_DURATION_SECONDS)
      || (clip.image !== undefined && clip.image !== null && clip.image !== "cover" && (
        path.basename(clip.image) !== clip.image
        || !/\.(png|jpe?g)$/i.test(clip.image)
        || !listImageNames(req.session).includes(clip.image)
      ))
    )
    || instrumentalClips.some((clip, index) => index > 0 && clip.start < instrumentalClips[index - 1].end)
  )) {
    return res.status(400).json({ error: "Instrumental clips must be valid, ordered ranges of at least 0.5 seconds" });
  }
  fs.writeFileSync(req.sessionPaths.clips, JSON.stringify(clips, null, 2));
  if (instrumentalClips !== undefined) {
    fs.writeFileSync(req.sessionPaths.instrumentalClips, JSON.stringify(instrumentalClips, null, 2));
  }
  if (fs.existsSync(req.sessionPaths.video)) fs.unlinkSync(req.sessionPaths.video);
  if (req.session.pipelineStatus === "done" || (req.session.pipelineStatus === "error" && req.session.pipelineStage === "render")) {
    req.session.pipelineStatus = "aligned";
    req.session.pipelineStage = "align";
  }
  req.session.clipsSaved = true;
  saveSession(req.session);
  res.json({ ok: true });
});

app.post("/api/clips/reset", attachActiveSession, preventSessionChangesDuringPipeline, (req, res) => {
  if (fs.existsSync(req.sessionPaths.clips)) fs.unlinkSync(req.sessionPaths.clips);
  if (fs.existsSync(req.sessionPaths.video)) fs.unlinkSync(req.sessionPaths.video);
  saveDefaultInstrumentalClips(req.session);
  if (req.session.pipelineStatus === "done" || (req.session.pipelineStatus === "error" && req.session.pipelineStage === "render")) {
    req.session.pipelineStatus = "aligned";
    req.session.pipelineStage = "align";
  }
  req.session.clipsSaved = false;
  saveSession(req.session);
  res.json({ ok: true });
});

// --- Cleanup ---
app.post("/api/cleanup", attachActiveSession, preventSessionChangesDuringPipeline, (req, res) => {
  const paths = req.sessionPaths;
  const coverImage = getCoverImageName(req.session);
  [
    paths.song, paths.lyrics, paths.subtitles, paths.timings, paths.clips, paths.video,
    coverImage ? path.join(paths.dir, coverImage) : null,
  ].filter(Boolean).forEach((file) => { if (fs.existsSync(file)) fs.unlinkSync(file); });
  listImageNames(req.session).forEach((name) => fs.unlinkSync(path.join(paths.bgDir, name)));
  updateImageManifest(req.session);
  updateCoverImageManifest(req.session);
  if (fs.existsSync(paths.instrumentalClips)) fs.unlinkSync(paths.instrumentalClips);
  req.session.name = "Untitled";
  req.session.pipelineStatus = "idle";
  req.session.pipelineStage = null;
  fs.writeFileSync(paths.pipelineLog, "");
  req.session.clipsSaved = false;
  saveSession(req.session);
  res.json({ ok: true });
});

// --- Download ---
app.get("/api/download", attachActiveSession, (req, res) => {
  const videoPath = req.sessionPaths.video;
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: "No video yet" });
  res.download(videoPath, `${req.session.name}.mp4`);
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
