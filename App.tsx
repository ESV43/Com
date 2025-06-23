import React, { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import StoryInputForm from './components/StoryInputForm';
import ComicDisplay from './components/ComicDisplay';
import LoadingSpinner from './components/LoadingSpinner';
import { StoryInputOptions, ComicPanelData, GenerationProgress, AspectRatio, GenerationService, CharacterDescription } from './types';
import {
  generateScenePrompts,
  generateImageForPrompt,
  generateScenePromptsWithPollinations,
  generateImageForPromptWithPollinations,
  generateCharacterDescriptions
} from './services/geminiService';
import { AVAILABLE_ASPECT_RATIOS } from './constants';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [comicPanels, setComicPanels] = useState<ComicPanelData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | undefined>(undefined);
  const [currentAspectRatio, setCurrentAspectRatio] = useState<AspectRatio>(AVAILABLE_ASPECT_RATIOS[0].value);

  const handleComicGeneration = useCallback(async (options: StoryInputOptions) => {
    // API Key checks
    if ((options.generationService === GenerationService.GEMINI || options.characterReferences.length > 0) && !apiKey.trim()) {
      setError("A Gemini API Key is required to use the Gemini service or the Character Reference feature.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setComicPanels([]);
    setCurrentAspectRatio(options.aspectRatio);
    setProgress(undefined);

    let scenePrompts: ComicPanelData[] = [];
    let characterDescriptions: CharacterDescription[] = [];
    
    try {
      // Step 1: Pre-process characters if using a service that needs text descriptions (Pollinations)
      const needsCharacterPreProcessing = options.generationService === GenerationService.POLLINATIONS && options.characterReferences.length > 0;

      if (needsCharacterPreProcessing) {
        setProgress({ currentStep: "Analyzing character references...", percentage: 5 });
        characterDescriptions = await generateCharacterDescriptions(apiKey, options.characterReferences, "gemini-pro-vision");
      }

      // Step 2: Generate Scene Prompts
      setProgress({ currentStep: "Analyzing story & generating scene prompts...", percentage: 10 });

      if (options.generationService === GenerationService.GEMINI) {
        scenePrompts = await generateScenePrompts(apiKey, options);
      } else {
        // Pass the pre-processed descriptions to Pollinations
        scenePrompts = await generateScenePromptsWithPollinations(options, characterDescriptions);
      }

      // **FALLBACK LOGIC**
      if (!scenePrompts || scenePrompts.length === 0) {
        setError("Warning: The AI could not break the story into scenes. Generating a single image from the full story text instead.");
        scenePrompts = [{
            scene_number: 1,
            image_prompt: `${options.story}, in the style of ${options.style}, ${options.era}`,
            caption: "Fallback: Full Story",
            dialogues: ["Scene generation failed."],
        }];
      }

      const initialPanels = scenePrompts.map(p => ({ ...p, imageUrl: undefined }));
      setComicPanels(initialPanels);

      const totalPanels = scenePrompts.length;
      setProgress({
        currentStep: `Generated ${totalPanels} prompts. Starting image generation...`,
        percentage: 25, // Update progress after scene gen
        totalPanels: totalPanels
      });

      // Step 3: Generate Images
      for (let i = 0; i < totalPanels; i++) {
        const panelProgressPercentage = 25 + ((i + 1) / totalPanels) * 75;
        setProgress({
          currentStep: `Generating image for panel ${i + 1}...`,
          percentage: panelProgressPercentage,
          currentPanel: i + 1,
          totalPanels: totalPanels,
        });

        const panel = scenePrompts[i];
        try {
          let imageUrl: string;
          if (options.generationService === GenerationService.GEMINI) {
            imageUrl = await generateImageForPrompt(
              apiKey, panel.image_prompt, options.aspectRatio,
              options.imageModel, options.style, options.era,
              options.characterReferences
            );
          } else {
            imageUrl = await generateImageForPromptWithPollinations(
              panel.image_prompt, options.imageModel, options.aspectRatio
            );
          }
          setComicPanels(prevPanels =>
            prevPanels.map(p => p.scene_number === panel.scene_number ? { ...p, imageUrl } : p)
          );
        } catch (imgError) {
          console.error(`Error generating image for panel ${panel.scene_number}:`, imgError);
          setComicPanels(prevPanels =>
            prevPanels.map(p => p.scene_number === panel.scene_number ? { ...p, imageUrl: 'error' } : p)
          );
          setError(prevError => {
            const imgErrMessage = imgError instanceof Error ? imgError.message : "Unknown image error";
            const panelErrMessage = `Error on panel ${panel.scene_number}: ${imgErrMessage}`;
            return prevError ? `${prevError}\n${panelErrMessage}` : panelErrMessage;
          });
        }
      }
      setProgress({ currentStep: "Comic generation complete!", percentage: 100, totalPanels: totalPanels, currentPanel: totalPanels });

    } catch (err) {
      console.error("Comic generation failed:", err);
      let errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(errorMessage);
      setComicPanels([]);
      setProgress(undefined);
    } finally {
      setTimeout(() => setIsLoading(false), 2000);
    }
  }, [apiKey]);

  const handleDownloadPdf = useCallback(async () => {
    // PDF generation code remains the same...
  }, [comicPanels, isLoading, currentAspectRatio]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="type-display-large">AI Comic Creator</h1>
        <p className="type-body-large">
          Turn your stories into stunning comic strips! Provide your narrative, choose your style, and let AI bring your vision to life.
        </p>
      </header>

      <main>
        {isLoading && <LoadingSpinner progress={progress} message={!progress && isLoading ? "Preparing your comic..." : undefined} />}
        
        <section className="api-key-section">
          <div className="form-input-container">
            <label htmlFor="apiKey" className="form-label">Your Gemini API Key (Optional)</label>
            <input
              type="password" id="apiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              className="form-input" placeholder="Enter here to use Gemini models"
              aria-describedby="apiKeyHelp"
            />
          </div>
          <p id="apiKeyHelp" className="input-description">
            Required for Gemini models and for the Character Reference feature. Pollinations models are free (without character references). Your key is not stored.
          </p>
        </section>

        <StoryInputForm
            onSubmit={handleComicGeneration} isLoading={isLoading}
            isApiKeyProvided={!!apiKey.trim()} currentProgress={progress}
        />

        {error && (
          <div className="error-message-container">
            <h3 className="type-title-medium">Operation Status</h3>
            {error.split('\n').map((errMsg, index) => <p key={index}>{errMsg}</p>)}
            <button onClick={() => setError(null)} className="btn error-dismiss-btn" aria-label="Dismiss message">
              Dismiss
            </button>
          </div>
        )}

        {comicPanels.length > 0 && !isLoading && (
          <div className="centered-action-button-container">
            <button
              onClick={handleDownloadPdf} disabled={isDownloadingPdf}
              className="btn btn-success" aria-label="Download Comic as PDF"
            >
              <span className="material-icons-outlined">download</span>
              {isDownloadingPdf ? 'Generating PDF...' : 'Download Comic as PDF'}
            </button>
          </div>
        )}

        <ComicDisplay panels={comicPanels} aspectRatioSetting={currentAspectRatio} />
      </main>

      <footer className="app-footer">
        <p>Powered by Gemini and Pollinations AI.</p>
         <p className="footer-fineprint">Comic Creator v3.2 - Final</p>
      </footer>
    </div>
  );
};

export default App;
