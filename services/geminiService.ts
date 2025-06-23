/**
 * @fileoverview This file contains the core service functions for interacting with AI models.
 * This version uses a hybrid workflow for Pollinations with characters and fixes the Gemini image model name.
 */

import { GoogleGenAI, GenerateContentResponse, GenerateImagesResponse, Part } from "@google/genai";
import {
  ComicPanelData,
  StoryInputOptions,
  AspectRatio,
  CharacterReference,
  PollinationsSceneOutput,
  PollinationsTextModel,
  ComicStyle,
  ComicEra,
  CharacterDescription,
} from '../types';
import { FIXED_IMAGE_SEED } from '../constants';

// --- Helper Functions ---
function dataUrlToGoogleGenerativeAIPart(dataUrl: string): Part {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data URL format");
    return { inlineData: { data: match[2], mimeType: match[1] } };
}

const blobToDataUrl = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function extractJsonAndGetScenes(text: string): PollinationsSceneOutput[] | null {
    if (!text) return null;
    const match = text.match(/```json\n([\s\S]*?)\n```|({[\s\S]*}|\[[\s\S]*\])/s);
    if (!match) return null;
    const jsonString = match[1] || match[2];
    try {
        const parsedData = JSON.parse(jsonString);
        if (Array.isArray(parsedData)) return parsedData;
        if (parsedData && Array.isArray(parsedData.scenes)) return parsedData.scenes;
        return null;
    } catch (e) {
        console.error("Could not parse extracted JSON:", e);
        return null;
    }
}


// --- Pollinations AI Service Functions ---

export const listPollinationsImageModels = async (): Promise<{ value: string; label: string }[]> => {
    try {
        const r = await fetch('https://image.pollinations.ai/models');
        return (await r.json()).map((m: string) => ({ value: m, label: m }));
    } catch (e) { return [{ value: 'flux', label: 'flux' }]; }
};

export const listPollinationsTextModels = async (): Promise<{ value: string; label: string }[]> => {
    try {
        const r = await fetch('https://text.pollinations.ai/models');
        return (await r.json()).map((m: PollinationsTextModel) => ({ value: m.name, label: `${m.name} (${m.description})` }));
    } catch (e) { return [{ value: 'llamascout', label: 'llamascout' }]; }
};

export const generateImageForPromptWithPollinations = async (prompt: string, model: string, aspectRatio: AspectRatio): Promise<string> => {
    const params = new URLSearchParams({ model, seed: String(FIXED_IMAGE_SEED) });
    if (aspectRatio === 'PORTRAIT') { params.set('width', '1024'); params.set('height', '1792'); }
    else if (aspectRatio === 'LANDSCAPE') { params.set('width', '1792'); params.set('height', '1024'); }
    else { params.set('width', '1024'); params.set('height', '1024'); }
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pollinations image API returned ${response.status}`);
    const imageBlob = await response.blob();
    if (!imageBlob.type.startsWith('image/')) throw new Error('API did not return a valid image.');
    return blobToDataUrl(imageBlob);
};

// CORRECTED: This now takes the pre-generated text descriptions and injects them into the prompt.
export const generateScenePromptsWithPollinations = async (options: StoryInputOptions, characterDescriptions: CharacterDescription[]): Promise<ComicPanelData[]> => {
  const { story, numPages, style, era, textModel } = options;

  let characterInstructions = "";
  if (characterDescriptions.length > 0) {
    const descriptions = characterDescriptions.map(cd => `- ${cd.name}: ${cd.description}`).join("\n");
    // REINFORCED PROMPT
    characterInstructions = `\n**ESSENTIAL INSTRUCTION FOR CHARACTER CONSISTENCY:**\nYou have been provided with descriptions of characters. You MUST use these exact descriptions in the 'image_prompt' for any scene featuring them.
**CHARACTER DESCRIPTIONS:**
${descriptions}\n`;
  }

  const systemPrompt = `You are a comic book writer. Your task is to break down the following story into ${numPages} scenes. Respond with ONLY a valid JSON array of objects.
${characterInstructions}
Story: """${story}"""`;

  try {
    const url = `https://text.pollinations.ai/${textModel}/${encodeURIComponent(systemPrompt)}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error(`Pollinations text API returned status ${response.status}`);
    const responseText = await response.text();
    const parsedScenes = extractJsonAndGetScenes(responseText);
    if (!parsedScenes) throw new Error("AI response did not contain a valid scenes array.");
    return parsedScenes.map((panel, index) => ({
        ...panel,
        scene_number: panel.scene_number || index + 1,
        image_prompt: `${panel.image_prompt}, in the style of ${style}, ${era}`,
    }));
  } catch (error) {
    console.error(`Error generating scenes with Pollinations:`, error);
    return [];
  }
};


// --- Google Gemini Service Functions ---

// NEW: This function is now the dedicated pre-processor for character images.
export const generateCharacterDescriptions = async (apiKey: string, references: CharacterReference[], textModel: string): Promise<CharacterDescription[]> => {
    if (!apiKey) return [];
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `For the following image, provide a concise but detailed visual description of the person shown. Focus on immutable features an artist can use for consistency: face shape, eye color, hair style and color, skin tone, and any distinct marks (scars, tattoos, glasses).`;
    
    const descriptionPromises = references.map(async (char) => {
        if (!char.imageDataUrl || !char.name) return null;
        try {
            const result = await ai.models.generateContent({
                model: textModel, // e.g., 'gemini-pro-vision'
                contents: [{ role: 'USER', parts: [ { text: prompt }, dataUrlToGoogleGenerativeAIPart(char.imageDataUrl)] }]
            });
            return { name: char.name, description: result.text.trim() };
        } catch (error) {
            console.error(`Could not generate description for ${char.name}:`, error);
            return null; // Fail gracefully for a single character
        }
    });

    return (await Promise.all(descriptionPromises)).filter(d => d !== null) as CharacterDescription[];
}


export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<ComicPanelData[]> => {
  const { story, style, era, numPages, textModel, characterReferences } = options;
  const ai = new GoogleGenAI({ apiKey });
  const promptParts: Part[] = [];
  
  const jsonSchema = `{ "scene_number": number, "image_prompt": "string", "caption": "string | null", "dialogues": ["string"] }`;
  let systemInstruction = `You are an expert comic book writer. Break the story into ${numPages} scenes. Style: ${style}, ${era} era.
**CRITICAL:** Respond with ONLY a single, valid JSON array of objects where each object matches this schema: ${jsonSchema}.
Story: """${story}"""`;

  if (characterReferences.length > 0) {
      systemInstruction = `You are a comic writer with vision capabilities. Analyze the story and character images.
1. For each character image, identify their key visual features.
2. When a character from the references appears, you MUST INJECT their detailed visual description into that scene's 'image_prompt' for consistency.
${systemInstruction}`;
  }
  
  promptParts.push({ text: systemInstruction });
  
  if (characterReferences.length > 0) {
    characterReferences.forEach(char => {
        if (char.imageDataUrl && char.name) {
            promptParts.push({ text: `\n--- Reference image for character: "${char.name}" ---` });
            promptParts.push(dataUrlToGoogleGenerativeAIPart(char.imageDataUrl));
        }
    });
  }

  try {
    const result = await ai.models.generateContent({
      model: textModel,
      contents: [{ role: 'USER', parts: promptParts }],
      config: { responseMimeType: "application/json" }
    });
    const scenesArray = extractJsonAndGetScenes(result.text);
    if (!scenesArray) throw new Error("AI response did not contain a valid scenes array.");
    return scenesArray.map((panel, index) => ({...panel, scene_number: panel.scene_number || index + 1 }));
  } catch (error) {
    console.error("Error generating scene prompts with Gemini:", error);
    throw error;
  }
};

// CORRECTED: Removed direct image passing logic from here as it was for the wrong API.
// This function now only handles text-to-image. Consistency is handled in the prompt generation step.
export const generateImageForPrompt = async (apiKey: string, initialImagePrompt: string, inputAspectRatio: AspectRatio, imageModelName: string, style: ComicStyle | string, era: ComicEra | string): Promise<string> => {
  if (!apiKey) throw new Error("API Key is required.");
  const ai = new GoogleGenAI({ apiKey });
  const augmentedPrompt = `${initialImagePrompt}, in the art style of ${style}, ${era} era.`;

  try {
    const result = await ai.models.generateImages({
        model: imageModelName,
        prompt: augmentedPrompt,
        count: 1,
        aspectRatio: inputAspectRatio === 'SQUARE' ? '1:1' : inputAspectRatio === 'PORTRAIT' ? '9:16' : '16:9',
        seed: FIXED_IMAGE_SEED,
        outputFormat: "b64-json"
    });
    const b64Json = result.generatedImages?.[0]?.image?.imageBytes;
    if (!b64Json) throw new Error("Image generation returned no image data.");
    return `data:image/png;base64,${b64Json}`;
  } catch (error) {
    console.error(`Error generating image with Gemini:`, error);
    throw new Error(`Failed to generate Gemini image: ${error instanceof Error ? error.message : "Unknown"}`);
  }
};
