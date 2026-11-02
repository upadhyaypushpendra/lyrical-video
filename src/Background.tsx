import React from "react";
import { interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

interface Segment { start: number; end: number; words?: { start: number; end: number }[]; }
interface InstrumentalClip { start: number; end: number; image?: string | null; }
interface Props {
  segments: Segment[];
  bgImages: string[];
  coverImage?: string | null;
  instrumentalClips?: InstrumentalClip[] | null;
}

const CROSSFADE = 0.5;
const VIDEO_DURATION = 160;
const MIN_INSTRUMENTAL_DURATION = 2;

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

export const Background: React.FC<Props> = ({ segments, bgImages, coverImage = null, instrumentalClips }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;

  const ci = segments.reduce((current, segment, index) => currentSec >= segment.start ? index : current, 0);
  const ni = segments.length ? Math.min(ci + 1, segments.length - 1) : 0;
  const nextStart = segments[ni]?.start ?? Infinity;
  const fadeOpacity = ci !== ni
    ? interpolate(currentSec, [nextStart - CROSSFADE, nextStart], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const img = (i: number) => staticFile(`bg/${bgImages[i % bgImages.length]}`);
  const segmentEnd = (segment: Segment | undefined) => {
    const lastWordEnd = segment?.words?.[segment.words.length - 1]?.end;
    return typeof lastWordEnd === "number" && Number.isFinite(lastWordEnd)
      ? lastWordEnd
      : segment?.end ?? VIDEO_DURATION;
  };
  const defaultInstrumentalClips = () => {
    const ranges: InstrumentalClip[] = [];
    let cursor = 0;
    for (const segment of segments) {
      if (segment.start - cursor >= MIN_INSTRUMENTAL_DURATION) ranges.push({ start: cursor, end: segment.start });
      const words = segment.words ?? [];
      if (words.length && words[0].start - segment.start >= MIN_INSTRUMENTAL_DURATION) {
        ranges.push({ start: segment.start, end: words[0].start });
      }
      for (let index = 1; index < words.length; index++) {
        const previousWord = words[index - 1];
        const word = words[index];
        if (word.start - previousWord.end >= MIN_INSTRUMENTAL_DURATION) {
          ranges.push({ start: previousWord.end, end: word.start });
        }
      }
      cursor = Math.max(cursor, segmentEnd(segment));
    }
    if (VIDEO_DURATION - cursor >= MIN_INSTRUMENTAL_DURATION) ranges.push({ start: cursor, end: VIDEO_DURATION });
    return ranges;
  };
  const coverClips = instrumentalClips ?? defaultInstrumentalClips();
  const activeCoverClip = coverClips.find((clip) => currentSec >= clip.start && currentSec < clip.end);
  const coverSrc = activeCoverClip?.image && activeCoverClip.image !== "cover"
    ? staticFile(`bg/${activeCoverClip.image}`)
    : coverImage ? staticFile(coverImage) : null;
  const coverOpacity = coverSrc && activeCoverClip ? 1 : 0;

  return (
    <div style={{ position: "absolute", width: "100%", height: "100%", overflow: "hidden", background: "#111" }}>
      {bgImages.length > 0 && (
        <>
          <KBImage
            src={img(ci)}
            idx={ci}
            start={segments[ci]?.start ?? 0}
            end={segments[ci + 1]?.start ?? segmentEnd(segments[ci])}
            opacity={1}
          />
          {ci !== ni && (
            <KBImage
              src={img(ni)}
              idx={ni}
              start={segments[ni]?.start ?? 0}
              end={segments[ni + 1]?.start ?? segmentEnd(segments[ni])}
              opacity={fadeOpacity}
            />
          )}
        </>
      )}
      {coverSrc && coverOpacity > 0 && (
        <KBImage
          src={coverSrc}
          idx={segments.length + coverClips.indexOf(activeCoverClip!)}
          start={activeCoverClip!.start}
          end={activeCoverClip!.end}
          opacity={coverOpacity}
        />
      )}
    </div>
  );
};
