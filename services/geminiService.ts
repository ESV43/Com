/**
 * @fileoverview This file contains the core service functions for interacting with AI models.
 * It handles comic generation for both Google Gemini and Pollinations AI.
 * This version uses the correct GET method for Pollinations text generation and a robust fallback signal.
 */

import {
  GoogleGenAI,
  GenerateContentResponse as SDKGenerateContentResponse,
  GenerateImagesResponse as SDKGenerateImagesResponse,
  Modality,
  HarmCategory,
  HarmProbability,
} from "@google/genai";
import {
  ComicPanelData,
  StoryInputOptions,
  AspectRatio,
  CaptionPlacement,
  ComicStyle,
  ComicEra,
  CharacterSheetDetails,
  PollinationsSceneOutput,
  PollinationsTextModel,
} from '../types';
import { FIXED_IMAGE_SEED } from '../constants';

// --- Helper Functions ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const blobToDataUrl = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function extractJsonArray(text: string): any[] | null {
    if (!text) return null;
    const match = text.match(/\[[\s\S]*\]/);
    if (match && match[0]) {
        try {
            return JSON.parse(match[0]);
        } catch (e) {
            console.error("Could not parse the extracted JSON array:", e);
            return null;
        }
    }
    return null;
}

interface SafetyRating {
  category: HarmCategory;
  probability: HarmProbability;
  blocked?: boolean;
}

interface LLMSceneResponse {
  characterCanon?: Record<string, CharacterSheetDetails>;
  scenes: PollinationsSceneOutput[];
}


// --- Pollinations AI Service Functions ---

export const listPollinationsImageModels = async (): Promise<{ value: string; label: string }[]> => {
  try {
    const response = await fetch('https://image.pollinations.ai/models');
    if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
    const models: string[] = await response.json();
    return models.map(model => ({ value: model, label: model }));
  } catch (error) {
    console.error("Could not fetch Pollinations image models:", error);
    return [{ value: 'flux', label: 'flux' }, { value: 'turbo', label: 'turbo' }, { value: 'gptimage', label: 'gptimage' }];
  }
};

export const listPollinationsTextModels = async (): Promise<{ value: string; label: string }[]> => {
    try {
        const response = await fetch('https://text.pollinations.ai/models');
        if (!response.ok) throw new Error(`Failed to fetch text models: ${response.statusText}`);
        const models: PollinationsTextModel[] = await response.json();
        return models.map(model => ({ value: model.name, label: `${model.name} (${model.description})` }));
    } catch (error) {
        console.error("Could not fetch Pollinations text models:", error);
        return [{ value: 'llamascout', label: 'llamascout (Llama 4 Scout)' }];
    }
};

export const generateImageForPromptWithPollinations = async (
    prompt: string,
    model: string,
    aspectRatio: AspectRatio
): Promise<string> => {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        
        const params = new URLSearchParams();
        params.append('model', model);

        switch (aspectRatio) {
            case AspectRatio.PORTRAIT:
                params.append('width', '1024');
                params.append('height', '1792');
                break;
            case AspectRatio.LANDSCAPE:
                params.append('width', '1792');
                params.append('height', '1024');
                break;
            case AspectRatio.SQUARE:
            default:
                params.append('width', '1024');
                params.append('height', '1024');
                break;
        }

        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
        console.log("Fetching Pollinations Image URL:", url);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Pollinations image API returned status ${response.status}`);
        }
        const imageBlob = await response.blob();
        if (!imageBlob.type.startsWith('image/')) {
           throw new Error('The API did not return a valid image.');
        }
        return await blobToDataUrl(imageBlob);
    } catch (error) {
        console.error("Error generating image with Pollinations:", error);
        throw new Error(`Failed to generate image from Pollinations. Error: ${error instanceof Error ? error.message : "Unknown"}`);
    }
};

export const generateScenePromptsWithPollinations = async (options: StoryInputOptions): Promise<ComicPanelData[]> => {
  const { story, numPages, style, era, characterReferences } = options;

  let characterInstruction = '';
  if (characterReferences && characterReferences.length > 0) {
    const characterNames = characterReferences.map(c => c.name).filter(Boolean).join(', ');
    if (characterNames) {
      characterInstruction = `
        IMPORTANT: Maintain visual consistency for these characters: ${characterNames}.
        For any scene involving them, describe their appearance in detail in the 'image_prompt'.
      `;
    }
  }
  const systemPrompt = `
    Break this story into ${numPages} scenes. Respond with ONLY a JSON array where each object has keys: "scene_number", "image_prompt", "caption", "dialogues". ${characterInstruction}
    Story: """${story}"""
  `;

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let responseText = '';
    try {
      if (attempt > 0) {
        console.log(`Retrying Pollinations text generation (GET)... Attempt ${attempt + 1}`);
        await delay(2000);
      }
      
      const encodedPrompt = encodeURIComponent(systemPrompt);
      const url = `https://text.pollinations.ai/${encodedPrompt}`;

      const response = await fetch(url, { method: 'GET' });

      responseText = await response.text();
      if (!response.ok) {
          throw new Error(`Pollinations text API returned status ${response.status}.`);
      }

      const parsedScenes = extractJsonArray(responseText);

      if (!parsedScenes || !Array.isArray(parsedScenes) || parsedScenes.length === 0) {
          throw new Error("AI response did not contain a valid, non-empty JSON array.");
      }

      // Success! Format and return the data.
      return parsedScenes.map((panel, index) => ({
          scene_number: panel.scene_number || index + 1,
          image_prompt: `${panel.image_prompt}, in the style of ${style}, ${era}`,
          caption: options.includeCaptions ? panel.caption : null,
          dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
      }));

    } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Attempt ${attempt + 1} failed:`, lastError.message);
        console.error("Raw response that may have caused the error:", responseText);
    }
  }
  
  // If all retries fail, return an empty array to signal the fallback.
  console.error(`All attempts to generate scenes failed. Last error: ${lastError?.message}. Triggering fallback mode.`);
  return [];
};

// --- Google Gemini Service Functions ---
export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<ComicPanelData[]> => {
  if (!apiKey) throw new Error("API Key is required to generate scene prompts.");
  const ai = new GoogleGenAI({ apiKey });
  const { story, style, era, includeCaptions, numPages, aspectRatio, textModel, captionPlacement, characterReferences } = options;

 let characterInstruction = '';
 if (characterReferences && characterReferences.length > 0) {
    const characterNames = characterReferences.map(ref => ref.name).filter(Boolean).join(', ');
    if (characterNames) {
        characterInstruction = `
          You are an expert comic book artist and writer. The user has provided a list of main characters: ${characterNames}. Your most important task is to maintain character consistency.
          To do this, you will first define a "characterCanon" object in your response. For each character, create a detailed description covering their facial features, hairstyle and color, gender, and a consistent outfit.
          Example for a character named 'Alex': { "Alex": { "IVAP": "A young man in his early 20s with sharp blue eyes, a scar over his left eyebrow, short spiky black hair, and always wearing a red leather jacket over a white t-shirt." } }.

          After defining the canon, you will break the story down into scenes. For EACH scene's "image_prompt", you MUST prepend the detailed description from the character canon for any character present in that scene.
          For example, if 'Alex' is in a scene, the image_prompt must start with his description before describing the action: "A young man in his early 20s with sharp blue eyes, a scar over his left eyebrow, short spiky black hair, and always wearing a red leather jacket over a white t-shirt, is seen jumping from a rooftop...".
          This is CRITICAL for image generation consistency. Your final output MUST be a single JSON object containing both the "characterCanon" and the "scenes" array.
        `;
    }
 }


  let aspectRatioDescription = `The user wants all images in a ${aspectRatio} aspect ratio. Generate image prompts that are mindful of this composition.`;
  if (aspectRatio === AspectRatio.LANDSCAPE) aspectRatioDescription = "16:9 landscape";
  else if (aspectRatio === AspectRatio.PORTRAIT) aspectRatioDescription = "9:16 portrait";

  let captionDialogueInstruction = '';
  if (includeCaptions) {
    if (captionPlacement === CaptionPlacement.IN_IMAGE) {
      captionDialogueInstruction = `...`; // Full prompt text here
    } else {
      captionDialogueInstruction = `...`; // Full prompt text here
    }
  } else {
    captionDialogueInstruction = `...`; // Full prompt text here
  }

  const systemInstruction = `
    You are a master comic creator AI. Your task is to take a story and other parameters and convert it into a structured JSON output for a comic book.
    You must respond with ONLY a valid JSON object. Do not include any markdown formatting like \`\`\`json.
    The JSON object must have two top-level keys: "characterCanon" and "scenes".

    ${characterInstruction}

    The "scenes" key must be an array of objects, where each object represents a single comic panel and has the following keys:
    - "scene_number": (Integer) The sequential number of the panel, starting from 1.
    - "image_prompt": (String) A detailed, descriptive prompt for an AI image generator. This should describe the characters, setting, action, mood, and composition. This prompt must incorporate the character descriptions from the characterCanon for consistency. It should also be tailored for a ${style} and ${era} aesthetic.
    ${captionDialogueInstruction}

    Now, process the following user request:
    - Story: """${story}"""
    - Number of Panels: ${numPages}
    - Aspect Ratio: ${aspectRatioDescription}
    - Style: ${style}
    - Era: ${era}
  `;

  try {
    const result: SDKGenerateContentResponse = await ai.models.generateContent({
      model: textModel,
      contents: [{ role: 'USER', parts: [{ text: systemInstruction }] }],
      config: { responseMimeType: "application/json" }
    });

    const parsedData: LLMSceneResponse = JSON.parse(result.text);
    return (parsedData.scenes || []).map((panel, index) => ({
      scene_number: panel.scene_number || index + 1,
      image_prompt: panel.image_prompt,
      caption: options.includeCaptions ? panel.caption : null,
      dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
    }));
  } catch (error) {
    console.error("Error generating scene prompts with Gemini:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("responseMimeType")) {
        throw new Error("The selected text model may not support JSON output. Please try a different model.");
    }
    throw new Error(`Failed to generate scene prompts: ${errorMessage}`);
  }
};

export const generateImageForPrompt = async (
  apiKey: string,
  initialImagePrompt: string,
  inputAspectRatio: AspectRatio,
  imageModelName: string,
  style: ComicStyle | string, 
  era: ComicEra | string     
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is required for image generation.");
  const ai = new GoogleGenAI({ apiKey });

  let apiAspectRatioValue: "1:1" | "9:16" | "16:9";
  switch (inputAspectRatio) {
    case AspectRatio.SQUARE: apiAspectRatioValue = "1:1"; break;
    case AspectRatio.PORTRAIT: apiAspectRatioValue = "9:16"; break;
    case AspectRatio.LANDSCAPE: apiAspectRatioValue = "16:9"; break;
    default: apiAspectRatioValue = "1:1";
  }

  const augmentedPrompt = `${initialImagePrompt}, in the style of ${style}, ${era}`;

  try {
      const result: SDKGenerateImagesResponse = await ai.models.generateImages({
          model: imageModelName,
          prompt: augmentedPrompt,
          number_of_images: 1,
          aspect_ratio: apiAspectRatioValue,
          seed: FIXED_IMAGE_SEED, // Using fixed seed for consistency
      });

      if (!result.generatedImages || result.generatedImages.length === 0) {
          throw new Error("The API did not return any images.");
      }

      // In browser environment, the SDK returns a Base64 string in imageBytes
      const imageBytes = result.generatedImages[0].image.imageBytes;
      if (typeof imageBytes !== 'string') {
          throw new Error("Image data is not in the expected format (base64 string).");
      }

      return `data:image/jpeg;base64,${imageBytes}`;
  } catch (error) {
      console.error("Error generating image with Gemini:", error);
      throw new Error(`Gemini image generation failed. ${error instanceof Error ? error.message : ""}`);
  }
};
