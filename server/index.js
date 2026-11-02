const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT = 3333;

app.use(express.static(path.join(__dirname, "../ui/dist")));
app.use(express.json());

const ROOT_DIR   = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BG_DIR     = path.join(PUBLIC_DIR, "bg");
const PYTHON_DIR = path.join(ROOT_DIR, "python");
const OUT_DIR    = path.join(ROOT_DIR, "out");
const CLIPS_PATH = path.join(PUBLIC_DIR, "clips.json");

[PUBLIC_DIR, BG_DIR, PYTHON_DIR, OUT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "song") cb(null, PYTHON_DIR);
    else if (file.fieldname === "images") cb(null, BG_DIR);
    else cb(null, PYTHON_DIR);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === "song") cb(null, "song.mp3");
    else cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "images" && !/\.(png|jpe?g)$/i.test(file.originalname)) {
      cb(new Error("Only PNG and JPEG images are supported."));
      return;
    }
    cb(null, true);
  },
});

app.post("/api/upload", (req, res, next) => {
  upload.fields([{ name: "song", maxCount: 1 }, { name: "images", maxCount: 50 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  if (req.body.lyrics) fs.writeFileSync(path.join(PYTHON_DIR, "lyrics.txt"), req.body.lyrics, "utf-8");
  res.json({ ok: true });
});

app.get("/api/assets", (req, res) => {
  const images = fs.existsSync(BG_DIR) ? fs.readdirSync(BG_DIR).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)) : [];
  const hasSong = fs.existsSync(path.join(PYTHON_DIR, "song.mp3"));
  const lyrics = fs.existsSync(path.join(PYTHON_DIR, "lyrics.txt")) ? fs.readFileSync(path.join(PYTHON_DIR, "lyrics.txt"), "utf-8") : "";
  res.json({ hasSong, images, lyrics });
});

app.get("/api/image/:filename", (req, res) => {
  const filename = req.params.filename;
  if (path.basename(filename) !== filename || !/\.(png|jpe?g)$/i.test(filename)) {
    return res.status(400).json({ error: "Invalid image filename" });
  }
  const imagePath = path.join(BG_DIR, filename);
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: "Image not found" });
  res.sendFile(imagePath);
});

app.delete("/api/image/:filename", (req, res) => {
  const file = path.join(BG_DIR, req.params.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// --- Pipeline state ---
// status: idle | aligning | aligned | rendering | done | error
let pipelineStatus = "idle";
let pipelineLog = [];

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true });
    proc.stdout.on("data", (d) => { const l = d.toString(); pipelineLog.push(l); process.stdout.write(l); });
    proc.stderr.on("data", (d) => { const l = d.toString(); pipelineLog.push(l); process.stderr.write(l); });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Exited with code ${code}`)));
  });
}

// Step 1 — Align lyrics
app.post("/api/align", async (req, res) => {
  if (pipelineStatus === "aligning" || pipelineStatus === "rendering") return res.status(409).json({ error: "Already running" });
  pipelineLog = [];
  pipelineStatus = "aligning";
  res.json({ ok: true });
  try {
    pipelineLog.push("Aligning lyrics to audio...\n");
    await runCommand(".venv\\Scripts\\python", ["make-video.py"], PYTHON_DIR);
    if (fs.existsSync(CLIPS_PATH)) fs.unlinkSync(CLIPS_PATH); // reset clips on new alignment
    pipelineStatus = "aligned";
    pipelineLog.push("✅ Alignment complete. Edit the timeline and render.\n");
  } catch (err) {
    pipelineStatus = "error";
    pipelineLog.push(`❌ ${err.message}\n`);
  }
});

// Step 2 — Render video
app.post("/api/render", async (req, res) => {
  if (pipelineStatus === "aligning" || pipelineStatus === "rendering") return res.status(409).json({ error: "Already running" });
  pipelineLog = [];
  pipelineStatus = "rendering";
  res.json({ ok: true });
  try {
    pipelineLog.push("Rendering video with Remotion...\n");
    await runCommand("npx", ["remotion", "render", "src/index.ts", "LyricalVideo", "out/video.mp4"], ROOT_DIR);
    pipelineStatus = "done";
    pipelineLog.push("✅ Video rendered successfully.\n");
  } catch (err) {
    pipelineStatus = "error";
    pipelineLog.push(`❌ ${err.message}\n`);
  }
});

app.get("/api/pipeline/status", (req, res) => {
  res.json({ status: pipelineStatus, log: pipelineLog.join("") });
});

// --- Clips ---
app.get("/api/clips", (req, res) => {
  if (fs.existsSync(CLIPS_PATH)) return res.json(JSON.parse(fs.readFileSync(CLIPS_PATH, "utf-8")));
  const timingsPath = path.join(PUBLIC_DIR, "timings.json");
  if (!fs.existsSync(timingsPath)) return res.json([]);
  const timings = JSON.parse(fs.readFileSync(timingsPath, "utf-8"));
  const images = fs.readdirSync(BG_DIR).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
  const segments = timings.segments;
  const totalDur = segments[segments.length - 1]?.end ?? 160;
  const clips = segments.map((seg, i) => ({
    id: i,
    image: images[i % images.length] ?? null,
    start: seg.start,
    end: i < segments.length - 1 ? segments[i + 1].start : totalDur,
    label: seg.text.trim(),
  }));
  fs.writeFileSync(CLIPS_PATH, JSON.stringify(clips, null, 2));
  res.json(clips);
});

app.post("/api/clips", (req, res) => {
  fs.writeFileSync(CLIPS_PATH, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.post("/api/clips/reset", (req, res) => {
  if (fs.existsSync(CLIPS_PATH)) fs.unlinkSync(CLIPS_PATH);
  res.json({ ok: true });
});

// --- Cleanup ---
app.post("/api/cleanup", (req, res) => {
  [
    path.join(PYTHON_DIR, "song.mp3"),
    path.join(PYTHON_DIR, "lyrics.txt"),
    path.join(PUBLIC_DIR, "song.ass"),
    path.join(PUBLIC_DIR, "timings.json"),
    CLIPS_PATH,
    path.join(OUT_DIR, "video.mp4"),
  ].forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  fs.readdirSync(BG_DIR).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).forEach((f) => fs.unlinkSync(path.join(BG_DIR, f)));
  pipelineStatus = "idle";
  pipelineLog = [];
  res.json({ ok: true });
});

// --- Download ---
app.get("/api/download", (req, res) => {
  const videoPath = path.join(OUT_DIR, "video.mp4");
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: "No video yet" });
  res.download(videoPath, "lyrical-video.mp4");
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
