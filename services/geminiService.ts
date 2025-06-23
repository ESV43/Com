/**
 * @fileoverview This file contains the core service functions for interacting with AI models.
 * It handles comic generation for both Google Gemini and Pollinations AI.
 * This version uses the correct API calling pattern and robust JSON parsing.
 */

import {
  GoogleGenAI,
  GenerateContentResponse as SDKGenerateContentResponse,
  GenerateImagesResponse as SDKGenerateImagesResponse,
  Part,
} from "@google/genai";
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
    if (!match) {
        console.error("No JSON block found in the response.");
        return null;
    }
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
    const response = await fetch('https://image.pollinations.ai/models');
    if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);
    return (await response.json()).map((model: string) => ({ value: model, label: model }));
  } catch (error) {
    console.error("Could not fetch Pollinations image models:", error);
    return [{ value: 'flux', label: 'flux' }];
  }
};

export const listPollinationsTextModels = async (): Promise<{ value: string; label: string }[]> => {
    try {
        const response = await fetch('https://text.pollinations.ai/models');
        if (!response.ok) throw new Error(`Failed to fetch text models: ${response.statusText}`);
        return (await response.json()).map((model: PollinationsTextModel) => ({ value: model.name, label: `${model.name} (${model.description})` }));
    } catch (error) {
        console.error("Could not fetch Pollinations text models:", error);
        return [{ value: 'llamascout', label: 'llamascout (Llama 4 Scout)' }];
    }
};

export const generateImageForPromptWithPollinations = async (prompt: string, model: string, aspectRatio: AspectRatio): Promise<string> => {
    const params = new URLSearchParams({ model, seed: String(FIXED_IMAGE_SEED) });
    switch (aspectRatio) {
        case AspectRatio.PORTRAIT: params.set('width', '1024'); params.set('height', '1792'); break;
        case AspectRatio.LANDSCAPE: params.set('width', '1792'); params.set('height', '1024'); break;
        default: params.set('width', '1024'); params.set('height', '1024'); break;
    }
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pollinations image API returned ${response.status}`);
    const imageBlob = await response.blob();
    if (!imageBlob.type.startsWith('image/')) throw new Error('API did not return a valid image.');
    return blobToDataUrl(imageBlob);
};

export const generateScenePromptsWithPollinations = async (options: StoryInputOptions, characterDescriptions: CharacterDescription[]): Promise<ComicPanelData[]> => {
  const { story, numPages, style, era, textModel } = options;

  let characterInstructions = "";
  if (characterDescriptions.length > 0) {
    const descriptions = characterDescriptions.map(cd => `- ${cd.name}: ${cd.description}`).join("\n");
    characterInstructions = `\n**CHARACTER DESCRIPTIONS FOR CONSISTENCY:**\n${descriptions}\nWhen a character from this list appears, you MUST use their description in the 'image_prompt'.\n`;
  }

  const systemPrompt = `You are an expert comic book writer. Your task is to break down the following story into ${numPages} comic book scenes.
Your entire response MUST be a single, valid JSON array of objects. Do not include any other text, greetings, or explanations.
Each object in the array must follow this schema:
{
  "scene_number": number,
  "image_prompt": "A detailed description of the scene, characters, and actions.",
  "caption": "A short narration for the scene. Null if no caption.",
  "dialogues": ["Character Name: 'Line of dialogue.'"]
}
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

export const generateCharacterDescriptions = async (apiKey: string, references: CharacterReference[], textModel: string): Promise<CharacterDescription[]> => {
    if (!apiKey) return [];
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `For each image, provide a concise but detailed visual description of the character shown. Focus on immutable features useful for artistic consistency: face shape, eye color, hair style and color, and any very distinct marks.`;
    
    const descriptionPromises = references.map(async (char) => {
        if (!char.imageDataUrl || !char.name) return null;
        try {
            const result = await ai.models.generateContent({
                model: textModel,
                contents: [{ role: 'USER', parts: [ { text: prompt }, dataUrlToGoogleGenerativeAIPart(char.imageDataUrl)] }]
            });
            const description = result.text.trim();
            return { name: char.name, description };
        } catch (error) {
            console.error(`Could not generate description for ${char.name}:`, error);
            return null;
        }
    });

    return (await Promise.all(descriptionPromises)).filter(d => d !== null) as CharacterDescription[];
}


export const generateScenePrompts = async (apiKey: string, options: StoryInputOptions): Promise<ComicPanelData[]> => {
  if (!apiKey) throw new Error("API Key is required.");
  const { story, style, era, numPages, textModel, characterReferences } = options;
  const ai = new GoogleGenAI({ apiKey });
  
  const promptParts: Part[] = [];
  const useVision = characterReferences.length > 0;

  const jsonSchema = `{ "scene_number": number, "image_prompt": "string", "caption": "string | null", "dialogues": ["string"] }`;
  let systemInstruction = `You are an expert comic book writer. Break the story into ${numPages} scenes. The style is ${style}, ${era} era.
**CRITICAL:** Respond with ONLY a single, valid JSON array where each object matches this schema: ${jsonSchema}.
Story: """${story}"""`;

  if (useVision) {
      systemInstruction = `You are a comic writer with vision. Analyze the story and character images.
1.  For each character image, create a detailed visual description.
2.  When a character appears, INJECT their description into the 'image_prompt' for consistency.
${systemInstruction}`;
  }
  
  promptParts.push({ text: systemInstruction });
  
  if (useVision) {
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
    const responseText = result.text;
    const scenesArray = extractJsonAndGetScenes(responseText);
    if (!scenesArray) throw new Error("AI response did not contain a valid scenes array.");

    return scenesArray.map((panel, index) => ({
      ...panel,
      scene_number: panel.scene_number || index + 1,
    }));
  } catch (error) {
    console.error("Error generating scene prompts with Gemini:", error);
    throw error;
  }
};

export const generateImageForPrompt = async (apiKey: string, initialImagePrompt: string, inputAspectRatio: AspectRatio, imageModelName: string, style: ComicStyle | string, era: ComicEra | string, characterReferences?: CharacterReference[]): Promise<string> => {
  if (!apiKey) throw new Error("API Key is required.");
  const ai = new GoogleGenAI({ apiKey });
  const augmentedPrompt = `${initialImagePrompt}, in the art style of ${style}, ${era} era.`;
  const promptParts: Part[] = [{ text: augmentedPrompt }];
  
  if (imageModelName === "gemini-2.0-flash-preview-image-generation" && characterReferences && characterReferences.length > 0) {
      promptParts.push({ text: "\n\n--- CHARACTER REFERENCES ---" });
      characterReferences.forEach(char => {
          if (char.imageDataUrl && char.name) {
              promptParts.push({ text: `This is a reference for "${char.name}". Maintain their appearance.` });
              promptParts.push(dataUrlToGoogleGenerativeAIPart(char.imageDataUrl));
          }
      });
  }

  try {
    const result = await ai.models.generateImages({
        model: imageModelName,
        prompt: promptParts,
        count: 1,
        aspectRatio: inputAspectRatio === 'SQUARE' ? '1:1' : inputAspectRatio === 'PORTRAIT' ? '9:16' : '16:9',
        seed: FIXED_IMAGE_SEED,
        outputFormat: "b64-json"
    });
    if (!result.generatedImages?.[0]?.image?.imageBytes) {
      throw new Error("Image generation returned no image data.");
    }
    return `data:image/png;base64,${result.generatedImages[0].image.imageBytes}`;
  } catch (error) {
    console.error(`Error generating image with Gemini:`, error);
    throw new Error(`Failed to generate Gemini image: ${error instanceof Error ? error.message : "Unknown"}`);
  }
};
