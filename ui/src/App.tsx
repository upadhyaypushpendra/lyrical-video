import React, { useEffect, useRef, useState } from "react";
import { Timeline, Clip } from "./Timeline";
import {
  AudioLines,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  Music2,
  RotateCcw,
  Save,
  X,
} from "lucide-react";

interface Assets { hasSong: boolean; images: string[]; lyrics: string; }
type PipelineStatus = "idle" | "aligning" | "aligned" | "rendering" | "done" | "error";
type PipelineStage = "align" | "render";
type PanelId = "assets" | "align" | "timeline" | "render";

const TOTAL_DUR = 160;

interface ProgressStep {
  label: string;
  percent: number | null;
  detail: string;
  complete?: boolean;
}

interface ProgressInfo {
  percent: number | null;
  message: string;
  error: boolean;
  steps?: ProgressStep[];
}

function getProgressInfo(log: string, stage: PipelineStage, status: PipelineStatus) {
  const lines = log
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (status === "error") {
    const errorLine = [...lines].reverse().find((line) => /❌|error|failed|exited with code/i.test(line));
    return { percent: null, message: errorLine ?? "The operation failed. Check the server output for details.", error: true };
  }

  if (stage === "render") {
    const bundlingLine = [...lines].reverse().find((line) => /bundling:\s*\d+(?:\.\d+)?%/i.test(line));
    const renderedLine = [...lines].reverse().find((line) => /rendered\s+\d+\s*\/\s*\d+/i.test(line));
    const bundlePercent = Number(bundlingLine?.match(/bundling:\s*(\d+(?:\.\d+)?)%/i)?.[1]);
    const renderedMatch = renderedLine?.match(/rendered\s+(\d+)\s*\/\s*(\d+)(?:,\s*time remaining:\s*([^,\r\n]+))?/i);
    const rendered = renderedMatch ? Number(renderedMatch[1]) : null;
    const totalFrames = renderedMatch ? Number(renderedMatch[2]) : null;
    const renderPercent = rendered !== null && totalFrames ? (rendered / totalFrames) * 100 : null;
    const eta = renderedMatch?.[3]?.trim();

    if (status === "done") {
      return {
        percent: 100,
        message: "Video rendered successfully.",
        error: false,
        steps: [
          { label: "Bundling", percent: 100, detail: "Complete", complete: true },
          { label: "Rendering", percent: 100, detail: "Complete", complete: true },
        ],
      };
    }

    return {
      percent: renderPercent ?? (Number.isFinite(bundlePercent) ? bundlePercent : null),
      message: renderedMatch ? "Rendering video" : bundlingLine ? "Preparing video bundle" : "Starting video render",
      error: false,
      steps: [
        {
          label: "Bundling",
          percent: renderedMatch ? 100 : Number.isFinite(bundlePercent) ? bundlePercent : null,
          detail: renderedMatch ? "Complete" : Number.isFinite(bundlePercent) ? `${Math.round(bundlePercent)}%` : "Preparing",
          complete: Boolean(renderedMatch),
        },
        {
          label: "Rendering",
          percent: renderPercent,
          detail: renderedMatch && rendered !== null && totalFrames !== null
            ? `${rendered.toLocaleString()} / ${totalFrames.toLocaleString()} frames${eta ? ` · ${eta} remaining` : ""}`
            : "Waiting for bundle",
        },
      ],
    };
  }

  const progressLine = [...lines].reverse().find((line) =>
    /align:\s*\d+(?:\.\d+)?%/i.test(line)
  );
  const percentMatch = progressLine?.match(/(\d+(?:\.\d+)?)%/);
  const fractionMatch = progressLine?.match(/(\d+)\s*\/\s*(\d+)/);
  const percent = percentMatch
    ? Math.max(0, Math.min(100, Number(percentMatch[1])))
    : fractionMatch
      ? Math.max(0, Math.min(100, (Number(fractionMatch[1]) / Number(fractionMatch[2])) * 100))
      : null;

  if (status === "aligned") return { percent: 100, message: "Alignment complete. Timeline is ready.", error: false };
  if (percent !== null) return { percent, message: `Aligning lyrics · ${Math.round(percent)}%`, error: false };
  if (lines.some((line) => /loading model/i.test(line))) {
    return { percent: null, message: "Loading speech recognition model…", error: false };
  }
  return { percent: null, message: "Aligning lyrics to the song…", error: false };
}

export default function App() {
  const [assets, setAssets] = useState<Assets>({ hasSong: false, images: [], lyrics: "" });
  const [lyrics, setLyrics] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [pipelineLog, setPipelineLog] = useState("");
  const [pipelineStage, setPipelineStage] = useState<PipelineStage | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipsSaved, setClipsSaved] = useState(false);
  const [selectedSong, setSelectedSong] = useState<File | null>(null);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const songRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAssets = async () => {
    const data = await fetch("/api/assets").then((r) => r.json());
    setAssets(data);
    setLyrics(data.lyrics);
  };

  const fetchClips = async () => {
    const data = await fetch("/api/clips").then((r) => r.json());
    setClips(data);
    setClipsSaved(false);
  };

  useEffect(() => { fetchAssets(); }, []);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const poll = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/pipeline/status");
        if (!res.ok) throw new Error(`Could not read pipeline status (${res.status}).`);
        const data = await res.json();
        setPipelineLog(data.log);
        setPipelineStatus(data.status);
        if (data.status === "aligned") {
          await fetchClips();
          clearInterval(pollRef.current!);
        }
        if (data.status === "done" || data.status === "error") clearInterval(pollRef.current!);
      } catch (error) {
        setPipelineStatus("error");
        setPipelineLog(error instanceof Error ? error.message : "Could not read pipeline status.");
        clearInterval(pollRef.current!);
      }
    }, 1000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("saving");
    setSaveError("");
    const form = new FormData();
    form.append("lyrics", lyrics);
    if (selectedSong) form.append("song", selectedSong);
    selectedImages.forEach((file) => form.append("images", file));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      }
      await fetchAssets();
      setSelectedSong(null);
      setSelectedImages([]);
      if (songRef.current) songRef.current.value = "";
      if (imagesRef.current) imagesRef.current.value = "";
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Upload failed. Please try again.");
    }
  };

  const handleAlign = async () => {
    setPipelineStatus("aligning");
    setPipelineLog("");
    setPipelineStage("align");
    try {
      const res = await fetch("/api/align", { method: "POST" });
      if (!res.ok) throw new Error(`Could not start alignment (${res.status}).`);
      poll();
    } catch (error) {
      setPipelineStatus("error");
      setPipelineLog(error instanceof Error ? error.message : "Could not start alignment.");
    }
  };

  const handleRender = async () => {
    setPipelineStatus("rendering");
    setPipelineLog("");
    setPipelineStage("render");
    try {
      const res = await fetch("/api/render", { method: "POST" });
      if (!res.ok) throw new Error(`Could not start rendering (${res.status}).`);
      poll();
    } catch (error) {
      setPipelineStatus("error");
      setPipelineLog(error instanceof Error ? error.message : "Could not start rendering.");
    }
  };

  const handleSaveClips = async () => {
    await fetch("/api/clips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clips) });
    setClipsSaved(true);
  };

  const handleResetClips = async () => {
    await fetch("/api/clips/reset", { method: "POST" });
    fetchClips();
  };

  const deleteImage = async (filename: string) => {
    await fetch(`/api/image/${encodeURIComponent(filename)}`, { method: "DELETE" });
    fetchAssets();
  };

  const handleNewSession = async () => {
    if (!confirm("This will delete all files and reset the session. Continue?")) return;
    await fetch("/api/cleanup", { method: "POST" });
    setPipelineStatus("idle");
    setPipelineLog("");
    setPipelineStage(null);
    setSaveStatus("idle");
    setSaveError("");
    setLyrics("");
    setClips([]);
    setClipsSaved(false);
    setSelectedSong(null);
    setSelectedImages([]);
    if (songRef.current) songRef.current.value = "";
    if (imagesRef.current) imagesRef.current.value = "";
    fetchAssets();
  };

  const canAlign = assets.hasSong && assets.images.length > 0 && assets.lyrics.trim().length > 0;
  const canRender = (pipelineStatus === "aligned" || pipelineStatus === "done" || pipelineStatus === "error") && clips.length > 0;
  const isRunning = pipelineStatus === "aligning" || pipelineStatus === "rendering";
  const alignmentComplete = pipelineStatus === "aligned" || pipelineStage === "render" || pipelineStatus === "done";
  const renderComplete = pipelineStatus === "done";
  const alignProgress = pipelineStage === "align" ? getProgressInfo(pipelineLog, "align", pipelineStatus) : null;
  const renderProgress = pipelineStage === "render" ? getProgressInfo(pipelineLog, "render", pipelineStatus) : null;
  const [openPanel, setOpenPanel] = useState<PanelId | null>("assets");

  useEffect(() => {
    if (!canAlign) {
      setOpenPanel("assets");
    } else if (pipelineStatus === "aligning" || (pipelineStatus === "error" && pipelineStage === "align")) {
      setOpenPanel("align");
    } else if (pipelineStatus === "rendering" || (pipelineStatus === "error" && pipelineStage === "render")) {
      setOpenPanel("render");
    } else if (pipelineStatus === "done") {
      setOpenPanel(null);
    } else if (clipsSaved) {
      setOpenPanel("render");
    } else if (alignmentComplete && clips.length > 0) {
      setOpenPanel("timeline");
    } else if (alignmentComplete) {
      setOpenPanel("align");
    } else {
      setOpenPanel("align");
    }
  }, [canAlign, pipelineStatus, pipelineStage, alignmentComplete, clips.length, clipsSaved]);

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon"><Music2 aria-hidden="true" size={22} /></span>
          <span className="logo-text">LyricalVideo</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-item active">Assets</div>
        </nav>

        <button className="new-session-btn" onClick={handleNewSession}>
          <RotateCcw aria-hidden="true" size={16} /> New Session
        </button>
      </aside>

      {/* Main */}
      <main className="main">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-steps">
            <Step n={1} label="Upload Assets" done={canAlign} />
            <div className="step-divider" />
            <Step n={2} label="Align Lyrics" done={pipelineStatus === "aligned" || pipelineStatus === "rendering" || pipelineStatus === "done"} active={pipelineStatus === "aligning"} />
            <div className="step-divider" />
            <Step n={3} label="Edit Timeline" done={clipsSaved} active={pipelineStatus === "aligned" && clips.length > 0} />
            <div className="step-divider" />
            <Step n={4} label="Render Video" done={pipelineStatus === "done"} active={pipelineStatus === "rendering"} />
          </div>
        </div>

        <div className="content">
          {/* Assets panel */}
          <div className="panel">
            <AccordionHeader
              step={1}
              title="Upload Assets"
              subtitle="Song, lyrics and background images"
              expanded={openPanel === "assets"}
              completed={canAlign}
              onToggle={() => setOpenPanel(openPanel === "assets" ? null : "assets")}
            />
            {openPanel === "assets" && <form onSubmit={handleSave} className="assets-form">
              <div className="form-row">
                {/* Song */}
                <div className="field">
                  <label>Song (MP3)</label>
                  <div className={`upload-box ${assets.hasSong ? "has-file" : ""}`}>
                    {selectedSong ? (
                      <span className="file-badge">Selected: {selectedSong.name}</span>
                    ) : assets.hasSong ? (
                      <span className="file-badge"><Check aria-hidden="true" size={14} /> Uploaded: song.mp3</span>
                    ) : null}
                    <input ref={songRef} type="file" accept=".mp3,audio/*" onChange={(e) => setSelectedSong(e.target.files?.[0] ?? null)} />
                    <span className="upload-hint">{assets.hasSong ? "Replace file" : "Click to upload"}</span>
                  </div>
                </div>

                {/* Images */}
                <div className="field">
                  <label>Background Images</label>
                  <div className="upload-box">
                    <input ref={imagesRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple onChange={(e) => setSelectedImages(Array.from(e.target.files ?? []))} />
                    <span className="upload-hint">Click to upload (multiple)</span>
                  </div>
                  {selectedImages.length > 0 && (
                    <div className="image-chips" aria-label="Selected images, not yet uploaded">
                      {selectedImages.map((file, index) => (
                        <span className="chip" key={`${file.name}-${index}`}>{file.name} (not saved)</span>
                      ))}
                    </div>
                  )}
                  {assets.images.length > 0 && (
                    <div className="image-chips">
                      {assets.images.map((img) => (
                        <div key={img} className="chip">
                          <span>{img}</span>
                          <button type="button" aria-label={`Remove ${img}`} onClick={() => deleteImage(img)}><X aria-hidden="true" size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Lyrics */}
              <div className="field">
                <label>Lyrics</label>
                <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Paste your lyrics here..." rows={8} />
              </div>

              <div className="form-footer">
                <button type="submit" className="btn btn-primary" disabled={saveStatus === "saving"}>
                  {saveStatus === "saving" ? "Saving..." : "Save Assets"}
                </button>
                {saveStatus === "saved" && <span className="badge badge-success"><Check aria-hidden="true" size={14} /> Saved</span>}
                {saveStatus === "error" && <span className="badge badge-error">{saveError}</span>}
                <span className="hint">Selected files upload when you click Save Assets.</span>
              </div>
            </form>}
          </div>

          {/* Step 2 — Align */}
          {canAlign && <div className="panel">
            <AccordionHeader
              step={2}
              title="Align Lyrics"
              subtitle="Sync lyrics to audio and generate the timeline"
              expanded={openPanel === "align"}
              completed={alignmentComplete}
              onToggle={() => setOpenPanel(openPanel === "align" ? null : "align")}
            />
            {openPanel === "align" && <div className="panel-body">
              <button className="btn btn-accent" onClick={handleAlign} disabled={!canAlign || isRunning}>
                {pipelineStatus === "aligning" ? <><Spinner /> Aligning...</> : <><AudioLines aria-hidden="true" size={16} /> Align Lyrics</>}
              </button>
              {(alignProgress || alignmentComplete) && (
                <PipelineProgress info={alignProgress ?? { percent: 100, message: "Alignment complete. Timeline is ready.", error: false }} active={pipelineStatus === "aligning"} complete={alignmentComplete} />
              )}
              {!canAlign && <p className="hint">Save a song, lyrics and at least one image first.</p>}
            </div>}
          </div>}

          {/* Timeline */}
          {alignmentComplete && clips.length > 0 && (
            <div className="panel panel-wide">
              <div className="timeline-accordion-row">
                <AccordionHeader
                  step={3}
                  title="Edit Timeline"
                  subtitle="Adjust image timing, replace or delete clips"
                  expanded={openPanel === "timeline"}
                  completed={clipsSaved}
                  onToggle={() => setOpenPanel(openPanel === "timeline" ? null : "timeline")}
                />
                {openPanel === "timeline" && (
                  <div className="panel-header-actions">
                    <button className="btn btn-ghost" onClick={handleResetClips}><RotateCcw aria-hidden="true" size={16} /> Reset</button>
                    <button className="btn btn-primary" onClick={handleSaveClips}><Save aria-hidden="true" size={16} /> Save Timeline</button>
                    {clipsSaved && <span className="badge badge-success"><Check aria-hidden="true" size={14} /> Saved</span>}
                  </div>
                )}
              </div>
              {openPanel === "timeline" && <Timeline clips={clips} images={assets.images} totalDur={TOTAL_DUR} onChange={(c) => { setClips(c); setClipsSaved(false); }} />}
            </div>
          )}

          {/* Step 3 — Render */}
          {clipsSaved && <div className="panel">
            <AccordionHeader
              step={4}
              title="Render Video"
              subtitle="Create the final video"
              expanded={openPanel === "render"}
              completed={renderComplete}
              onToggle={() => setOpenPanel(openPanel === "render" ? null : "render")}
            />
            {openPanel === "render" && <div className="panel-body">
              <button className="btn btn-success" onClick={handleRender} disabled={!canRender || isRunning}>
                {pipelineStatus === "rendering" ? <><Spinner /> Rendering...</> : <><Clapperboard aria-hidden="true" size={16} /> Render Video</>}
              </button>
              {(renderProgress || renderComplete) && (
                <PipelineProgress info={renderProgress ?? { percent: 100, message: "Video rendered successfully.", error: false }} active={pipelineStatus === "rendering"} complete={renderComplete} />
              )}
              {!canRender && pipelineStatus !== "rendering" && <p className="hint">Align lyrics and save the timeline first.</p>}
            </div>}
          </div>}

          {/* Download */}
          {pipelineStatus === "done" && (
            <div className="panel done-panel">
              <span className="done-icon">🎉</span>
              <div>
                <h2>Your video is ready!</h2>
                <p className="panel-sub">Download it below</p>
              </div>
              <a className="btn btn-primary" href="/api/download" download><Download aria-hidden="true" size={16} /> Download Video</a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AccordionHeader({ step, title, subtitle, expanded, completed, onToggle }: {
  step: number;
  title: string;
  subtitle: string;
  expanded: boolean;
  completed: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="panel-header accordion-header" aria-expanded={expanded} onClick={onToggle}>
      <span className="accordion-heading">
        <ChevronDown className={`accordion-chevron ${expanded ? "expanded" : ""}`} aria-hidden="true" size={18} />
        <span className={`accordion-step ${completed ? "complete" : ""}`}>{completed ? <Check aria-hidden="true" size={15} /> : step}</span>
        <span>
          <span className="accordion-title">{title}</span>
          <span className="panel-sub">{subtitle}</span>
        </span>
      </span>
      <span className="accordion-indicator">
        {completed && <span className="accordion-complete">Complete</span>}
      </span>
    </button>
  );
}

function PipelineProgress({ info, active, complete }: { info: ProgressInfo; active: boolean; complete: boolean }) {
  return (
    <div className={`pipeline-progress ${info.error ? "error" : complete ? "complete" : ""}`} role="status" aria-live="polite">
      <div className="pipeline-progress-label">
        <span>{info.message}</span>
        {active && <span className="pipeline-progress-state">In progress</span>}
        {complete && <span className="pipeline-progress-state">Complete</span>}
      </div>
      {!info.error && info.steps ? (
        <div className="pipeline-progress-steps">
          {info.steps.map((step) => (
            <div className={`pipeline-progress-step ${step.complete ? "complete" : ""}`} key={step.label}>
              <div className="pipeline-progress-label">
                <span>{step.label}</span>
                <span>{step.detail}</span>
              </div>
              <div className="pipeline-progress-track" role="progressbar" aria-label={`${step.label}: ${step.detail}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={step.percent ?? undefined}>
                <div className={`pipeline-progress-value ${step.percent === null ? "indeterminate" : ""}`} style={step.percent === null ? undefined : { width: `${step.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : !info.error && (
        <div className="pipeline-progress-track" role="progressbar" aria-label={info.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={info.percent ?? undefined}>
          <div className={`pipeline-progress-value ${info.percent === null ? "indeterminate" : ""}`} style={info.percent === null ? undefined : { width: `${info.percent}%` }} />
        </div>
      )}
    </div>
  );
}

function Step({ n, label, done, active }: { n: number; label: string; done?: boolean; active?: boolean }) {
  return (
    <div className={`step ${done ? "done" : ""} ${active ? "active" : ""}`}>
      <div className="step-num">{done ? <Check aria-hidden="true" size={14} /> : n}</div>
      <span className="step-label">{label}</span>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" />;
}
