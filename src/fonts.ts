import { loadFont as loadMukta } from "@remotion/google-fonts/Mukta";
import { loadFont as loadTiroHindi } from "@remotion/google-fonts/TiroDevanagariHindi";
import { loadFont as loadNotoSans } from "@remotion/google-fonts/NotoSansDevanagari";
import { loadFont as loadNotoSerif } from "@remotion/google-fonts/NotoSerifDevanagari";
import { loadFont as loadPlaypen } from "@remotion/google-fonts/PlaypenSansDeva";
import { loadFont as loadRajdhani } from "@remotion/google-fonts/Rajdhani";
import { loadFont as loadYantramanav } from "@remotion/google-fonts/Yantramanav";

export const FONTS: string[] = [
  loadMukta("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
  loadTiroHindi("normal", { weights: ["400"], subsets: ["devanagari"] }).fontFamily,
  loadNotoSans("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
  loadNotoSerif("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
  loadPlaypen("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
  loadRajdhani("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
  loadYantramanav("normal", { weights: ["700"], subsets: ["devanagari"] }).fontFamily,
];
