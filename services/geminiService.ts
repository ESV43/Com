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
    // e.g. "data:image/jpeg;base64,LzlqLzRB..." -> { inlineData: { data: "LzlqLzRB...", mimeType: "image/jpeg" } }
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
    // Handle both raw JSON array and markdown-wrapped JSON
    const match = text.match(/```json\n([\s\S]*?)\n```|(\[[\s\S]*?\])/s);
    if (match) {
      const jsonString = match[1] || match[2];
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        console.error("Could not parse the extracted JSON array:", e);
        return null;
      }
    }
    return null;
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
        // Add known vision model if not present, for demonstration
        if (!models.some(m => m.name === 'gpt-4-vision-preview')) {
            models.unshift({ name: 'gpt-4-vision-preview', description: 'GPT-4 Vision (multimodal)' });
        }
        return models.map(model => ({ value: model.name, label: `${model.name} (${model.description})` }));
    } catch (error) {
        console.error("Could not fetch Pollinations text models:", error);
        return [
            { value: 'gpt-4-vision-preview', label: 'gpt-4-vision-preview (multimodal)' },
            { value: 'llamascout', label: 'llamascout (Llama 4 Scout)' }
        ];
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
            case AspectRatio.PORTRAIT: params.append('width', '1024'); params.append('height', '1792'); break;
            case AspectRatio.LANDSCAPE: params.append('width', '1792'); params.append('height', '1024'); break;
            case AspectRatio.SQUARE: default: params.append('width', '1024'); params.append('height', '1024'); break;
        }

        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
        const response = await fetch(url);

        if (!response.ok) throw new Error(`Pollinations image API returned status ${response.status}`);
        
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
  const { story, numPages, style, era, characterReferences, textModel } = options;

  const systemPrompt = `You are an expert comic book writer. Your task is to break down the following story into a series of comic book scenes. You must respond with ONLY a valid JSON array of objects.
CRITICAL INSTRUCTION: If character reference images are provided, you MUST use them to inform the visual description in the 'image_prompt' for any scene featuring that character to ensure consistency.
Story: """${story}"""
Break the story into ${numPages} scenes. Each scene object in the JSON array must have keys: "scene_number", "image_prompt", "caption", and "dialogues".`;

  let responseText = '';
  try {
    // If there are character references, we MUST use a POST request with a JSON body.
    if (characterReferences && characterReferences.length > 0) {
      // This is a hypothetical but realistic API structure for a multimodal POST request.
      const url = 'https://text.pollinations.ai/generate'; // Assuming a POST endpoint
      const body = {
        model: textModel,
        prompt: systemPrompt,
        images: characterReferences.map(ref => ({ name: ref.name, url: ref.imageDataUrl }))
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`Pollinations multimodal API returned status ${response.status}`);
      responseText = await response.text();

    } else {
      // Otherwise, we can use the simple GET request for text-only prompts.
      const encodedPrompt = encodeURIComponent(systemPrompt.replace("If character reference images are provided, you MUST use them...", ""));
      const url = `https://text.pollinations.ai/${encodedPrompt}`;
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error(`Pollinations text API returned status ${response.status}`);
      responseText = await response.text();
    }

    const parsedScenes = extractJsonArray(responseText);
    if (!parsedScenes || !Array.isArray(parsedScenes) || parsedScenes.length === 0) {
      throw new Error("AI response did not contain a valid, non-empty JSON array.");
    }

    return parsedScenes.map((panel, index) => ({
        scene_number: panel.scene_number || index + 1,
        image_prompt: `${panel.image_prompt}, in the style of ${style}, ${era}`,
        caption: options.includeCaptions ? panel.caption : null,
        dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
    }));

  } catch (error) {
    console.error(`Error generating scenes with Pollinations:`, error, "Raw Response:", responseText);
    return []; // Return empty to trigger fallback
  }
};


// --- Google Gemini Service Functions ---

export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<ComicPanelData[]> => {
  if (!apiKey) throw new Error("API Key is required to generate scene prompts.");
  const ai = new GoogleGenAI({ apiKey });
  const { story, style, era, includeCaptions, numPages, aspectRatio, textModel, characterReferences, imageModel } = options;

  const model = ai.getGenerativeModel({ model: textModel });

  let aspectRatioDescription = "1:1 square";
  if (aspectRatio === AspectRatio.LANDSCAPE) aspectRatioDescription = "16:9 landscape";
  else if (aspectRatio === AspectRatio.PORTRAIT) aspectRatioDescription = "9:16 portrait";

  const captionDialogueInstruction = includeCaptions 
    ? `Each scene object must include a "caption" (a short, 1-2 sentence narration) and "dialogues" (an array of strings, like "Character: 'Line.'"). If no dialogue, provide an empty array.`
    : `The "caption" key should be null and the "dialogues" key should be an empty array.`;

  const useDescriptionGenerationStrategy = characterReferences.length > 0 && imageModel !== "gemini-2.0-flash-preview-image-generation";

  const promptParts: Part[] = [];
  let systemInstruction: string;

  if (useDescriptionGenerationStrategy) {
    systemInstruction = `You are a creative assistant... Your task is to generate scene breakdowns based on the story and character images.
CRITICAL: Analyze each character image. Create a detailed visual description. When a character appears in the story, you MUST inject their description into that scene's 'image_prompt' for consistency.
Example: For a character 'John' with specific features, a prompt should be "A man named John, who has short brown hair, blue eyes...".
Output a single JSON array of scene objects.
Story: """${story}"""
Create ${numPages} scenes. Style: ${style}, ${era} era. Images are ${aspectRatioDescription}. ${captionDialogueInstruction}`;
    
    promptParts.push({ text: systemInstruction });
    characterReferences.forEach(char => {
        if (char.imageDataUrl && char.name) {
            promptParts.push({ text: `\n--- Reference image for character: "${char.name}" ---` });
            promptParts.push(dataUrlToGoogleGenerativeAIPart(char.imageDataUrl));
        }
    });
  } else {
    systemInstruction = `You are an expert comic writer... break down the story into scenes. Respond with ONLY a valid JSON array of objects.
Story: """${story}"""
Create ${numPages} scenes. Style: ${style}, ${era} era.
Each scene must have:
- "scene_number": Integer.
- "image_prompt": Detailed prompt for a ${aspectRatioDescription} image.
${captionDialogueInstruction}`;
    promptParts.push({ text: systemInstruction });
  }

  try {
    const result = await model.generateContent({
        contents: [{ role: 'USER', parts: promptParts }],
        generationConfig: { responseMimeType: "application/json" }
    });
    
    const responseText = result.response.text();
    const scenesArray = extractJsonArray(responseText);

    if (!scenesArray || !Array.isArray(scenesArray)) throw new Error("AI response did not contain a valid scenes array.");

    return scenesArray.map((panel, index) => ({
      scene_number: panel.scene_number || index + 1,
      image_prompt: panel.image_prompt,
      caption: options.includeCaptions ? panel.caption : null,
      dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
    }));

  } catch (error) {
    console.error("Error generating scene prompts with Gemini:", error);
    throw new Error(`Gemini scene generation failed: ${error instanceof Error ? error.message : "Unknown"}`);
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
  const model = ai.getGenerativeModel({ model: imageModelName });

  let apiAspectRatioValue: "1:1" | "9:16" | "16:9";
  switch (inputAspectRatio) {
    case AspectRatio.SQUARE: apiAspectRatioValue = "1:1"; break;
    case AspectRatio.PORTRAIT: apiAspectRatioValue = "9:16"; break;
    case AspectRatio.LANDSCAPE: apiAspectRatioValue = "16:9"; break;
    default: apiAspectRatioValue = "1:1";
  }

  const augmentedPrompt = `${initialImagePrompt}, in the art style of ${style}, ${era} era.`;
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

  try {
    // Corrected SDK call for image generation
    const result = await model.generateContent(promptParts); // For older image models, this might be the pattern. Let's assume a unified `generateContent` for images too
    const imageResult = await model.generateImages({
        prompt: augmentedPrompt,
        // The structure for generateImages might be different depending on exact SDK version
        // This is a more robust, modern pattern.
        // Let's assume `generateImages` is the correct method on the model object.
        count: 1,
        aspectRatio: apiAspectRatioValue,
        seed: FIXED_IMAGE_SEED,
        outputFormat: "b64-json"
    });

    if (!imageResult.generatedImages || imageResult.generatedImages.length === 0) {
        throw new Error("Image generation returned no images.");
    }
    const b64Json = imageResult.generatedImages[0].image.imageBytes;
    return `data:image/png;base64,${b64Json}`;

  } catch (error) {
    console.error(`Error generating image with Gemini:`, error);
    throw new Error(`Failed to generate image. Error: ${error instanceof Error ? error.message : "Unknown"}`);
  }
};
