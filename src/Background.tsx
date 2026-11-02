import React from "react";
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

interface Segment { start: number; end: number; }
interface Props { segments: Segment[]; bgImages: string[]; }

const CROSSFADE = 0.5;

const KB = [
  { from: [1.00,  0,  0], to: [1.12, -2, -2] },
  { from: [1.12,  0,  0], to: [1.00,  0,  0] },
  { from: [1.10, -3,  0], to: [1.10,  3,  0] },
  { from: [1.10,  3,  0], to: [1.10, -3,  0] },
  { from: [1.10,  0, -3], to: [1.10,  0,  3] },
  { from: [1.10,  0,  3], to: [1.10,  0, -3] },
  { from: [1.00, -2, -2], to: [1.12,  2,  2] },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const KBImage: React.FC<{ src: string; idx: number; start: number; end: number; opacity: number }> = ({ src, idx, start, end, opacity }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(frame / fps, [start, Math.max(end, start + 0.1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const { from, to } = KB[idx % KB.length];
  const scale = lerp(from[0], to[0], t);
  const tx = lerp(from[1], to[1], t);
  const ty = lerp(from[2], to[2], t);
  return (
    <img src={src} style={{
      position: "absolute", width: "100%", height: "100%", objectFit: "cover",
      opacity, transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
      transformOrigin: "center center", willChange: "transform",
    }} />
  );
};

export const Background: React.FC<Props> = ({ segments, bgImages }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  if (bgImages.length === 0)
    return <div style={{ position: "absolute", width: "100%", height: "100%", background: "#111" }} />;

  const ci = (() => { for (let i = segments.length - 1; i >= 0; i--) if (currentSec >= segments[i].start) return i; return 0; })();
  const ni = Math.min(ci + 1, segments.length - 1);
  const nextStart = segments[ni]?.start ?? Infinity;

  const fadeOpacity = interpolate(currentSec, [nextStart - CROSSFADE, nextStart], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const img = (i: number) => staticFile(`bg/${bgImages[i % bgImages.length]}`);
  const segEnd = (i: number) => segments[i + 1]?.start ?? segments[i]?.end ?? 160;

  return (
    <div style={{ position: "absolute", width: "100%", height: "100%", overflow: "hidden" }}>
      <KBImage src={img(ci)} idx={ci} start={segments[ci]?.start ?? 0} end={segEnd(ci)} opacity={1} />
      {ci !== ni && <KBImage src={img(ni)} idx={ni} start={segments[ni]?.start ?? 0} end={segEnd(ni)} opacity={fadeOpacity} />}
    </div>
  );
};
