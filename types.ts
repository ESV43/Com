export enum ComicStyle {
  TWO_D = "2D Animation",
  THREE_D = "3D Rendered",
  REALISTIC = "Photorealistic",
  ANIME = "Anime/Manga",
  CARTOON = "Classic Cartoon",
}

export enum ComicEra {
  OLD = "Vintage/Retro (e.g., 1950s-1970s style)",
  NEW = "Modern/Contemporary (e.g., 2000s-Present style)",
  FUTURISTIC = "Futuristic/Sci-Fi"
}

export enum AspectRatio {
  SQUARE = "SQUARE", // 1:1
  PORTRAIT = "PORTRAIT", // 9:16
  LANDSCAPE = "LANDSCAPE" // 16:9
}

// New enum to select the generation service
export enum GenerationService {
  GEMINI = "Gemini (API Key Required)",
  POLLINATIONS = "Pollinations (Free, No API Key)",
}

// These are now primarily for Gemini, but we keep the type for simplicity
export enum ImageGenerationModel {
  IMAGEN_3 = "imagen-3.0-generate-002",
  GEMINI_2_FLASH_IMG = "gemini-2.0-flash-preview-image-generation",
}

export enum TextGenerationModel {
  GEMINI_2_5_FLASH = "gemini-2.5-flash",
  GEMINI_2_5_FLASH_LITE = "gemini-2.5-flash-lite-preview-06-17",
  GEMINI_2_5_PRO = "gemini-2.5-pro",
  GEMINI_2_0_FLASH = "gemini-2.0-flash",
}

export enum CaptionPlacement {
  IN_UI = "In User Interface",
  IN_IMAGE = "Embedded in Image"
}

export interface CharacterReference {
  id: string; // for react keys
  name: string;
  imageDataUrl: string | null;
  file: File | null;
}

export interface CharacterDescription {
  name: string;
  description: string;
}

export interface ComicPanelData {
  scene_number: number;
  image_prompt: string;
  caption: string | null;
  dialogues: string[];
  imageUrl?: string; // To be filled after image generation
  scene_description_for_prompt?: string; // Internal helper for Gemini
}

// Updated to include the generation service and use string for models
export interface StoryInputOptions {
  story: string;
  style: ComicStyle;
  era: ComicEra;
  aspectRatio: AspectRatio;
  includeCaptions: boolean;
  numPages: number;
  imageModel: string; // Generic string to support both services
  textModel: string;  // Generic string to support both services
  captionPlacement: CaptionPlacement;
  generationService: GenerationService; // Added
  characterReferences: CharacterReference[];
}

export interface GenerationProgress {
  currentStep: string;
  percentage: number;
  currentPanel?: number;
  totalPanels?: number;
}

// Type for a single Pollinations text model from their API
export interface PollinationsTextModel {
    name: string;
    description: string;
    [key: string]: any; // Allow other properties
}

// Type for the simplified scene structure from Pollinations
export interface PollinationsSceneOutput {
  scene_number: number;
  image_prompt: string;
  caption: string | null;
  dialogues: string[];
}


// --- Unchanged Gemini-specific types below ---
export interface GroundingChunk {
  web?: { uri: string; title: string; };
  retrievedContext?: { uri:string; title: string; };
}
export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
}
export interface Candidate {
  groundingMetadata?: GroundingMetadata;
}
export interface GenerateContentResponse {
  text: string;
  candidates?: Candidate[];
}
export interface GeneratedImage {
  image: { imageBytes: string; };
}
export interface GenerateImagesResponse {
  generatedImages: GeneratedImage[];
}
export interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}
export interface CharacterSheetDetails {
    IVAP: string;
    appearance: string;
    attire: string;
    genderIdentityNote?: string | null;
}
