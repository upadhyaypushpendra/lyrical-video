import React, { useEffect, useState } from "react";
import { Composition, continueRender, delayRender, staticFile } from "remotion";
import { LyricalVideo } from "./LyricalVideo";

const FPS = 30;
const TOTAL_DURATION_SEC = 160;

// Webpack require.context to pick up all images in public/bg/ at bundle time
const imageContext = (require as any).context("../public/bg", false, /\.(png|jpg|jpeg)$/);
const BG_IMAGES: string[] = imageContext.keys().map((k: string) => k.replace("./", ""));

export const Root: React.FC = () => {
  const [timings, setTimings] = useState<object | null>(null);
  const [handle] = useState(() => delayRender("Loading timings"));

  useEffect(() => {
    fetch(staticFile("timings.json"))
      .then((r) => r.json())
      .then((data) => {
        setTimings(data);
        continueRender(handle);
      })
      .catch(() => {
        // timings.json not generated yet — continue with empty
        setTimings({ segments: [] });
        continueRender(handle);
      });
  }, []);

  if (!timings) return null;

  return (
    <Composition
      id="LyricalVideo"
      component={LyricalVideo}
      durationInFrames={TOTAL_DURATION_SEC * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ timings, bgImages: BG_IMAGES }}
    />
  );
};
