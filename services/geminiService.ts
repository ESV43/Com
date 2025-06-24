/**
 * @fileoverview This file contains the core service functions for interacting with AI models.
 * It handles comic generation for both Google Gemini and Pollinations AI.
 * This version uses a multimodal approach and robust data validation for resilience.
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
            const parsed = JSON.parse(match[0]);
            return Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            console.error("Could not parse the extracted JSON array:", e);
            return null;
        }
    }
    return null;
}

function dataUrlToGenerativePart(dataUrl: string, mimeType?: string): Part {
  const matches = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!matches) throw new Error("Invalid data URL format");
  return { inlineData: { mimeType: mimeType || matches[1], data: matches[2] } };
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
    return [{ value: 'flux', label: 'flux' }, { value: 'turbo', label: 'turbo' }];
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

export const generateImageForPromptWithPollinations = async (prompt: string, model: string, aspectRatio: AspectRatio): Promise<string> => {
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        const params = new URLSearchParams({ model });
        if (aspectRatio === AspectRatio.PORTRAIT) {
            params.set('width', '1024');
            params.set('height', '1792');
        } else if (aspectRatio === AspectRatio.LANDSCAPE) {
            params.set('width', '1792');
            params.set('height', '1024');
        } else {
            params.set('width', '1024');
            params.set('height', '1024');
        }
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Pollinations image API returned status ${response.status}`);
        const imageBlob = await response.blob();
        if (!imageBlob.type.startsWith('image/')) throw new Error('The API did not return a valid image.');
        return await blobToDataUrl(imageBlob);
    } catch (error) {
        throw new Error(`Failed to generate image from Pollinations: ${error instanceof Error ? error.message : "Unknown"}`);
    }
};

export const generateScenePromptsWithPollinations = async (options: StoryInputOptions): Promise<ComicPanelData[]> => {
  const { story, numPages, style, era } = options;
  const systemPrompt = `Break this story into ${numPages} scenes. Respond with ONLY a JSON array where each object has keys: "scene_number", "image_prompt", "caption", "dialogues". Story: """${story}"""`;
  try {
      const encodedPrompt = encodeURIComponent(systemPrompt);
      const url = `https://text.pollinations.ai/${encodedPrompt}`;
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error(`Pollinations text API returned status ${response.status}.`);
      const responseText = await response.text();
      const parsedScenes = extractJsonArray(responseText);
      if (!parsedScenes) throw new Error("AI response did not contain a valid JSON array.");
      return parsedScenes.map((panel, index) => ({
          scene_number: panel.scene_number || index + 1,
          image_prompt: `${panel.image_prompt || ''}, in the style of ${style}, ${era}`,
          caption: options.includeCaptions ? panel.caption : null,
          dialogues: options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : [],
      })).filter(Boolean);
  } catch (error) {
    console.error("All attempts to generate scenes with Pollinations failed:", error);
    return [];
  }
};

// --- Google Gemini Service Functions ---
export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<{ scenes: ComicPanelData[]; characterCanon?: Record<string, CharacterSheetDetails> }> => {
  if (!apiKey) throw new Error("API Key is required.");
  const ai = new GoogleGenAI({ apiKey });
  const { story, style, era, includeCaptions, numPages, aspectRatio, textModel, characterReferences } = options;

  const requestParts: Part[] = [];
  const validCharacterRefs = characterReferences.filter(ref => ref.name && ref.imageDataUrl);
  let characterInstruction = 'Your primary task is to break the story into scenes.';
  
  if (validCharacterRefs.length > 0) {
    characterInstruction = `You are an expert comic book artist. You have been provided reference images for the main characters. Your most important task is to maintain character consistency.
      1.  **Analyze the images provided.** For each character, create a detailed textual description of their face, hair, and clothing. This will be your "characterCanon".
      2.  **Break the story into scenes.**
      3.  **For EACH scene's "image_prompt", you MUST prepend the detailed description from the characterCanon** for any character present in that scene. This is CRITICAL for consistency.
      Your final output MUST be a single JSON object with "characterCanon" and "scenes" keys.`;
    
    requestParts.push({ text: `Analyze these characters for the story:\n` });
    validCharacterRefs.forEach(ref => {
      requestParts.push(dataUrlToGenerativePart(ref.imageDataUrl));
      requestParts.push({ text: `This is the character named: ${ref.name}\n` });
    });
  }

  const mainPrompt = `Here is the story and the rules for creating the comic.
    **COMIC CREATION RULES**
    - JSON ONLY: Respond with ONLY a valid JSON object. Do not use markdown.
    - TOP-LEVEL KEYS: The JSON must have "characterCanon" and "scenes".
    - CHARACTER CANON: ${characterInstruction}
    - SCENES ARRAY: The "scenes" key must be an array of objects, each with "scene_number", "image_prompt", "caption", and "dialogues".
    - IMAGE PROMPT: A detailed prompt for an AI image generator, tailored for a ${style} and ${era} aesthetic. It MUST include the full description from your generated characterCanon if a character is present.
    - CAPTIONS/DIALOGUES: ${includeCaptions ? 'Create short, impactful text for captions and dialogues.' : 'Set captions and dialogues to null or empty array.'}
    **USER STORY**
    - Story: """${story}"""
    - Number of Panels: ${numPages}
    - Aspect Ratio: The user wants images in a ${aspectRatio} aspect ratio.`;
  requestParts.push({ text: mainPrompt });

  try {
    const result = await ai.models.generateContent({
      model: textModel,
      contents: [{ role: 'USER', parts: requestParts }],
      config: { responseMimeType: "application/json" }
    });
    
    const parsedData: LLMSceneResponse = JSON.parse(result.text);
    
    // **ROBUST VALIDATION**
    if (!parsedData || !Array.isArray(parsedData.scenes)) {
        console.error("Invalid data structure from AI:", parsedData);
        throw new Error("The AI returned data in an unexpected format. The 'scenes' property is missing or not an array.");
    }

    // **SAFE MAPPING & FILTERING**
    const scenes = parsedData.scenes.map((panel, index) => {
        if (typeof panel !== 'object' || panel === null) return null; // Safety check
        return {
          scene_number: panel.scene_number || index + 1,
          image_prompt: panel.image_prompt || '', // Prevent crash if missing
          caption: (options.includeCaptions ? panel.caption : null) || null,
          dialogues: (options.includeCaptions && Array.isArray(panel.dialogues) ? panel.dialogues : []),
        };
    }).filter((panel): panel is ComicPanelData => panel !== null); // Remove invalid panels

    return { scenes, characterCanon: parsedData.characterCanon };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("responseMimeType")) {
        throw new Error("The selected text model may not support JSON output or multimodal analysis. Please try a different model (e.g., Gemini 2.5 Flash).");
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
  era: ComicEra | string,
  characterCanon?: Record<string, CharacterSheetDetails>,
  sceneCharacterNames?: string[],
  characterReferences?: { name: string; imageDataUrl: string }[],
) : Promise<string> => {
  if (!apiKey) throw new Error("API Key is required.");
  const ai = new GoogleGenAI({ apiKey });
  let augmentedPrompt = `${initialImagePrompt}, in the style of ${style}, ${era}`;

  if (characterCanon && sceneCharacterNames && sceneCharacterNames.length > 0) {
    const descs = sceneCharacterNames
      .map(name => characterCanon[name]?.appearance || characterCanon[name]?.IVAP || "")
      .filter(Boolean)
      .join("\n");
    if (descs) {
      augmentedPrompt = `${descs}\n${augmentedPrompt}`;
    }
  }

  if (imageModelName.startsWith('imagen')) {
    const apiAspectRatioValue = inputAspectRatio === 'PORTRAIT' ? '9:16' : inputAspectRatio === 'LANDSCAPE' ? '16:9' : '1:1';
    try {
        const result = await ai.models.generateImages({
            model: imageModelName, prompt: augmentedPrompt, number_of_images: 1,
            aspect_ratio: apiAspectRatioValue, seed: FIXED_IMAGE_SEED,
        });
        return `data:image/jpeg;base64,${result.generatedImages[0].image.imageBytes}`;
    } catch (error) {
        throw new Error(`Imagen image generation failed: ${error instanceof Error ? error.message : ""}`);
    }
  }

  if (imageModelName === 'gemini-2.0-flash-preview-image-generation' && characterReferences && sceneCharacterNames) {
    const relevantRefs = characterReferences.filter(ref => sceneCharacterNames.includes(ref.name));
    const parts: Part[] = [];
    relevantRefs.forEach(ref => {
      parts.push(dataUrlToGenerativePart(ref.imageDataUrl));
      parts.push({ text: `This is the character named: ${ref.name}` });
    });
    parts.push({ text: augmentedPrompt });
    const aspectRatioHint = `Render in ${inputAspectRatio.toLowerCase()} aspect ratio.`;
    parts.push({ text: aspectRatioHint });
    try {
      const result = await ai.models.generateContent({
        model: imageModelName,
        contents: [{ role: 'USER', parts }],
        config: { responseModalities: [Modality.IMAGE] }
      });
      const imagePart = result.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
      if (imagePart?.inlineData) {
        return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      }
      throw new Error("The Gemini API did not return a valid image in its response.");
    } catch (error) {
      throw new Error(`Gemini image generation failed: ${error instanceof Error ? error.message : "Prompt may have been blocked."}`);
    }
  }

  if (imageModelName.startsWith('gemini')) {
    const aspectRatioHint = `Render in ${inputAspectRatio.toLowerCase()} aspect ratio.`;
    const finalPrompt = `${augmentedPrompt}. ${aspectRatioHint}`;
    try {
      const result = await ai.models.generateContent({
        model: imageModelName,
        contents: [{ role: 'USER', parts: [{ text: finalPrompt }] }],
        config: { responseModalities: [Modality.IMAGE] }
      });
      const imagePart = result.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);
      if (imagePart?.inlineData) {
        return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
      }
      throw new Error("The Gemini API did not return a valid image in its response.");
    } catch (error) {
      throw new Error(`Gemini image generation failed: ${error instanceof Error ? error.message : "Prompt may have been blocked."}`);
    }
  }

  throw new Error(`Unsupported image model type: ${imageModelName}.`);
};
