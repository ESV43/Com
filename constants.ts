import { ComicStyle, ComicEra, AspectRatio, GenerationService, CaptionPlacement } from './types';

export const MAX_COMIC_PAGES = 200;
export const DEFAULT_NUM_PAGES = 6;
export const MAX_CHARACTERS = 5;
export const FIXED_IMAGE_SEED = 42;

export const AVAILABLE_SERVICES: { value: GenerationService; label: string }[] = [
  { value: GenerationService.GEMINI, label: "Gemini (API Key Required)" },
  { value: GenerationService.POLLINATIONS, label: "Pollinations (Free, No Key)" },
];

export const AVAILABLE_STYLES: { value: ComicStyle; label: string }[] = [
  { value: ComicStyle.TWO_D, label: "2D Animation" },
  { value: ComicStyle.THREE_D, label: "3D Rendered" },
  { value: ComicStyle.REALISTIC, label: "Photorealistic" },
  { value: ComicStyle.ANIME, label: "Anime/Manga" },
  { value: ComicStyle.CARTOON, label: "Classic Cartoon" },
];

export const AVAILABLE_ERAS: { value: ComicEra; label: string }[] = [
  { value: ComicEra.OLD, label: "Vintage (1950s-70s)" },
  { value: ComicEra.NEW, label: "Modern (2000s-Now)" },
  { value: ComicEra.FUTURISTIC, label: "Futuristic/Sci-Fi" },
];

export const AVAILABLE_ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: AspectRatio.SQUARE, label: "Square (1:1)" },
  { value: AspectRatio.PORTRAIT, label: "Portrait (9:16)" },
  { value: AspectRatio.LANDSCAPE, label: "Landscape (16:9)" },
];

// CORRECTED: Removed the faulty model and simplified to a single, stable option.
export const AVAILABLE_GEMINI_IMAGE_MODELS: { value: string; label: string }[] = [
  { value: "imagen-3.0-generate-002", label: "Imagen 3 (Recommended)" },
];

export const AVAILABLE_GEMINI_TEXT_MODELS: { value: string; label: string }[] = [
  { value: "gemini-pro-vision", label: "Gemini Pro Vision (For Characters)" },
  { value: "gemini-1.5-flash-latest", label: "Gemini 1.5 Flash (Default)" },
  { value: "gemini-1.0-pro", label: "Gemini 1.0 Pro" },
];

export const AVAILABLE_CAPTION_PLACEMENTS: { value: CaptionPlacement; label: string }[] = [
  { value: CaptionPlacement.IN_UI, label: "Show in UI (below image)" },
  { value: CaptionPlacement.IN_IMAGE, label: "Embed in image (Experimental)" },
];

// Default models
export const DEFAULT_TEXT_MODEL = "gemini-1.5-flash-latest";
// CORRECTED: Updated the default to the valid model.
export const DEFAULT_GEMINI_IMAGE_MODEL = "imagen-3.0-generate-002";
export const DEFAULT_POLLINATIONS_IMAGE_MODEL = "flux";
export const DEFAULT_POLLINATIONS_TEXT_MODEL = "llamascout";
export const DEFAULT_CAPTION_PLACEMENT = CaptionPlacement.IN_UI;
