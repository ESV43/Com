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
  Part,
} from "@google/genai";
import {
  ComicPanelData,
  StoryInputOptions,
  AspectRatio,
  CaptionPlacement,
  ComicStyle,
  ComicEra,
  CharacterSheetDetails,
  CharacterReference,
  PollinationsSceneOutput,
  PollinationsTextModel,
} from '../types';
import { FIXED_IMAGE_SEED } from '../constants';

// --- Helper Functions ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function dataUrlToGoogleGenerativeAIPart(dataUrl: string): Part {
    // e.g. "data:image/jpeg;base64,LzlqLzRB..." -> { data: "LzlqLzRB...", mimeType: "image/jpeg" }
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
        throw new Error("Invalid data URL format");
    }
    const mimeType = match[1];
    const data = match[2];
    return { inlineData: { data, mimeType } };
}

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
        params.append('seed', String(FIXED_IMAGE_SEED));

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
  const { story, numPages, style, era } = options;
  
  const systemPrompt = `
    Break this story into ${numPages} scenes. Respond with ONLY a JSON array where each object has keys: "scene_number", "image_prompt", "caption", "dialogues".
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

// --- Google Gemini Service Functions (Full, Unchanged Implementation) ---
export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<ComicPanelData[]> => {
  if (!apiKey) throw new Error("API Key is required to generate scene prompts.");
  const ai = new GoogleGenAI({ apiKey });
  const { story, style, era, includeCaptions, numPages, aspectRatio, textModel, captionPlacement, characterReferences, imageModel } = options;

  let aspectRatioDescription = "1:1 square";
  if (aspectRatio === AspectRatio.LANDSCAPE) aspectRatioDescription = "16:9 landscape";
  else if (aspectRatio === AspectRatio.PORTRAIT) aspectRatioDescription = "9:16 portrait";

  let captionDialogueInstruction = '';
  if (includeCaptions) { // This part is simplified for brevity
      captionDialogueInstruction = `Each scene object must include a "caption" (a short, 1-2 sentence narration for the panel) and "dialogues" (an array of strings, with each string being one character's line, like "Character Name: 'Hello!'"). If a scene has no dialogue, provide an empty array.`;
  } else {
      captionDialogueInstruction = `Do not include captions or dialogues. The "caption" key should be null and the "dialogues" key should be an empty array.`;
  }

  const useDescriptionGeneration = characterReferences && characterReferences.length > 0 && imageModel !== "gemini-2.0-flash-preview-image-generation";

  let systemInstruction: string;
  const promptParts: Part[] = [];

  if (useDescriptionGeneration) {
    systemInstruction = `You are a creative assistant for a comic book artist. Based on the story and the following character reference images, your primary task is to generate scene breakdowns.
CRITICAL INSTRUCTION: For each character image provided, first mentally create a detailed, consistent visual description. Pay close attention to facial features, hair style and color, and unique attributes.
When you then break down the story into scenes, you MUST inject these detailed character descriptions into the 'image_prompt' for any panel featuring that character. This ensures the image generation AI can create a consistent look for them across all panels.
For example, if the story says "John walks in", and you have a description for John, the image prompt should be something like "A man named John, who has short brown hair, blue eyes, a square jaw, and is wearing a red jacket, walks into a room...".
The final output MUST be a single JSON object containing only a 'scenes' array as requested before. Do not output a separate character sheet. All character details must be embedded within the scene prompts.
Here is the story: """${story}"""
Break it into ${numPages} scenes.
The comic style is ${style}, from the ${era} era.
The images should be in ${aspectRatioDescription} format.
${captionDialogueInstruction}`;
    
    promptParts.push({ text: systemInstruction });
    characterReferences.forEach(char => {
        if (char.imageDataUrl && char.name) {
            promptParts.push({ text: `\n--- Reference image for character: "${char.name}" ---` });
            promptParts.push(dataUrlToGoogleGenerativeAIPart(char.imageDataUrl));
        }
    });
  } else {
    systemInstruction = `You are an expert comic book writer and artist. Your task is to break down the following story into a series of comic book scenes. You must respond with ONLY a valid JSON array of objects, where each object represents one scene.
Story: """${story}"""
Create exactly ${numPages} scenes.
The comic style is ${style}, from the ${era} era.
Each scene object must have these keys:
- "scene_number": An integer (starting from 1).
- "image_prompt": A detailed, descriptive prompt for an AI image generator to create the panel art. This should include the setting, characters, actions, mood, and composition. The prompt should be tailored for a ${aspectRatioDescription} image.
${captionDialogueInstruction}
Do not include any text outside of the JSON array.`;
    promptParts.push({ text: systemInstruction });
  }

  try {
    const result: SDKGenerateContentResponse = await ai.models.generateContent({
      model: textModel,
      contents: [{ role: 'USER', parts: promptParts }],
      config: { responseMimeType: "application/json" }
    });
    
    const responseText = result.text;
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```|(\[[\s\S]*\])/);
    const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : responseText;

    const parsedData = JSON.parse(jsonString);

    // The AI might return the scenes inside a "scenes" key or as the root array
    const scenesArray: PollinationsSceneOutput[] = Array.isArray(parsedData) ? parsedData : parsedData.scenes;

    if (!scenesArray || !Array.isArray(scenesArray)) throw new Error("AI response did not contain a valid scenes array.");

    return scenesArray.map((panel, index) => ({
      scene_number: panel.scene_number || index + 1,
      image_prompt: panel.image_prompt,
      caption: options.includeCaptions ? panel.caption : null,
      dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
    }));

  } catch (error) {
    console.error("Error generating scene prompts with Gemini:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini scene generation failed: ${error.message}`);
    }
    throw new Error("An unknown error occurred during Gemini scene generation.");
  }
};

export const generateImageForPrompt = async (
  apiKey: string,
  initialImagePrompt: string,
  inputAspectRatio: AspectRatio,
  imageModelName: string,
  style: ComicStyle | string,
  era: ComicEra | string,
  characterReferences?: CharacterReference[]
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

  const augmentedPrompt = `${initialImagePrompt}, in the art style of ${style}, ${era} era.`;
  
  const maxRetries = 2;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retrying Gemini image generation... Attempt ${attempt + 1}`);
        await delay(2000 * attempt);
      }

      const imageGenModel = ai.getGenerativeModel({ model: imageModelName });
      const promptParts: Part[] = [{ text: augmentedPrompt }];
      
      const useMultimodalPrompt = imageModelName === "gemini-2.0-flash-preview-image-generation" && characterReferences && characterReferences.length > 0;

      if (useMultimodalPrompt) {
          promptParts.push({ text: "\n\n--- CHARACTER REFERENCES ---" });
          characterReferences.forEach(char => {
              if (char.imageDataUrl && char.name) {
                  promptParts.push({ text: `This is a reference for the character named "${char.name}". Maintain their appearance based on this image.` });
                  promptParts.push(dataUrlToGoogleGenerativeAIPart(char.imageDataUrl));
              }
          });
      }

      const result: SDKGenerateImagesResponse = await imageGenModel.generateImages({
        prompt: promptParts,
        count: 1,
        aspectRatio: apiAspectRatioValue,
        seed: FIXED_IMAGE_SEED,
        outputFormat: "b64-json"
      });

      if (!result.generatedImages || result.generatedImages.length === 0) {
        throw new Error("Image generation returned no images.");
      }

      const b64Json = result.generatedImages[0].image.imageBytes;
      return `data:image/png;base64,${b64Json}`;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt + 1} failed for image generation:`, lastError.message);
    }
  }

  throw new Error(`Failed to generate image after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`);
};
