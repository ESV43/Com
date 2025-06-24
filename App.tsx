import React, { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import StoryInputForm from './components/StoryInputForm';
import ComicDisplay from './components/ComicDisplay';
import LoadingSpinner from './components/LoadingSpinner';
import { StoryInputOptions, ComicPanelData, GenerationProgress, AspectRatio, GenerationService } from './types';
import {
  generateScenePrompts,
  generateImageForPrompt,
  generateScenePromptsWithPollinations,
  generateImageForPromptWithPollinations
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
    if (options.generationService === GenerationService.GEMINI && !apiKey.trim()) {
      setError("Please enter your Gemini API Key to generate comics with the Gemini service.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setComicPanels([]);
    setCurrentAspectRatio(options.aspectRatio);
    setProgress(undefined);

    try {
      setProgress({ currentStep: "Analyzing story & generating scene prompts...", percentage: 0 });

      let scenePrompts: ComicPanelData[] = [];
      if (options.generationService === GenerationService.GEMINI) {
        scenePrompts = await generateScenePrompts(apiKey, options);
      } else {
        scenePrompts = await generateScenePromptsWithPollinations(options);
      }

      // Fallback logic if scene generation fails or returns an empty array
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
        percentage: 10,
        totalPanels: totalPanels
      });

      for (let i = 0; i < totalPanels; i++) {
        const panelProgressPercentage = 10 + ((i + 1) / totalPanels) * 90;
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
              options.imageModel, options.style, options.era
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
          // Accumulate errors for display
          setError(prevError => {
            const imgErrMessage = imgError instanceof Error ? imgError.message : "Unknown image error";
            const panelErrMessage = `Error on panel ${panel.scene_number}: ${imgErrMessage}`;
            return prevError ? `${prevError}\n${panelErrMessage}` : panelErrMessage;
          });
        }
      }
      setProgress({ currentStep: "Comic generation complete!", percentage: 100, totalPanels: totalPanels, currentPanel: totalPanels });
      // On success, wait a moment before hiding the spinner to show the "complete" message
      setTimeout(() => setIsLoading(false), 2000);

    } catch (err) {
      console.error("Comic generation failed:", err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during scene generation.";
      setError(errorMessage);
      setComicPanels([]);
      setProgress(undefined);
      // On failure, hide the spinner immediately
      setIsLoading(false);
    }
  }, [apiKey]);

  const handleDownloadPdf = useCallback(async () => {
    if (comicPanels.length === 0 || isLoading) return;
    setIsDownloadingPdf(true);

    try {
      const isLandscape = currentAspectRatio === AspectRatio.LANDSCAPE;
      const pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const A4_WIDTH_MM = isLandscape ? 297 : 210;
      const A4_HEIGHT_MM = isLandscape ? 210 : 297;
      const MARGIN_MM = 10;
      const MAX_IMG_WIDTH = A4_WIDTH_MM - 2 * MARGIN_MM;
      const MAX_IMG_HEIGHT_AREA = A4_HEIGHT_MM * 0.65 - MARGIN_MM;
      const TEXT_START_Y_OFFSET = 10;

      for (let i = 0; i < comicPanels.length; i++) {
        const panel = comicPanels[i];
        if (i > 0) pdf.addPage();

        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.text(`Panel ${panel.scene_number}`, MARGIN_MM, MARGIN_MM + 5);

        if (panel.imageUrl && panel.imageUrl !== 'error') {
          try {
            const img = new Image();
            img.src = panel.imageUrl;
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Image failed to load for PDF generation.'));
            });

            const aspectRatioVal = img.width / img.height;
            let pdfImgWidth = MAX_IMG_WIDTH;
            let pdfImgHeight = pdfImgWidth / aspectRatioVal;
            if (pdfImgHeight > MAX_IMG_HEIGHT_AREA) {
              pdfImgHeight = MAX_IMG_HEIGHT_AREA;
              pdfImgWidth = pdfImgHeight * aspectRatioVal;
            }
            const imgX = (A4_WIDTH_MM - pdfImgWidth) / 2;
            const imgY = MARGIN_MM + 10;

            pdf.addImage(panel.imageUrl, 'JPEG', imgX, imgY, pdfImgWidth, pdfImgHeight);
            let currentTextY = imgY + pdfImgHeight + TEXT_START_Y_OFFSET;

            if (panel.caption) {
              pdf.setFontSize(12);
              pdf.setTextColor(0);
              const captionLines = pdf.splitTextToSize(`Caption: ${panel.caption}`, MAX_IMG_WIDTH);
              pdf.text(captionLines, MARGIN_MM, currentTextY);
              currentTextY += (captionLines.length * 5) + 5;
            }

            if (panel.dialogues && panel.dialogues.length > 0) {
              pdf.setFontSize(10);
              pdf.setTextColor(50);
              panel.dialogues.forEach(dialogue => {
                if (currentTextY > A4_HEIGHT_MM - MARGIN_MM - 10) {
                    pdf.addPage();
                    currentTextY = MARGIN_MM;
                    pdf.text(`Panel ${panel.scene_number} (cont.)`, MARGIN_MM, currentTextY);
                    currentTextY += 10;
                }
                const dialogueLines = pdf.splitTextToSize(dialogue, MAX_IMG_WIDTH);
                pdf.text(dialogueLines, MARGIN_MM, currentTextY);
                currentTextY += (dialogueLines.length * 4) + 2;
              });
            }
          } catch (e) {
            console.error("Error processing image for PDF for panel " + panel.scene_number, e);
            pdf.setTextColor(255, 0, 0).text("Error loading image for this panel.", MARGIN_MM, MARGIN_MM + 20);
          }
        } else {
          pdf.setTextColor(255, 0, 0).text(
            panel.imageUrl === 'error' ? "Image generation failed for this panel." : "Image not available for this panel.",
            MARGIN_MM, MARGIN_MM + 20
          );
        }
      }
      pdf.save('ai-comic.pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unknown error occurred while generating the PDF.");
    } finally {
      setIsDownloadingPdf(false);
    }
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
            <input type="password" id="apiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="form-input" placeholder="Enter here to use premium Gemini models" aria-describedby="apiKeyHelp" />
          </div>
          <p id="apiKeyHelp" className="input-description">
            Required only for Gemini models. Pollinations models are free and do not need a key. Your key is not stored.
          </p>
        </section>

        <StoryInputForm onSubmit={handleComicGeneration} isLoading={isLoading} isApiKeyProvided={!!apiKey.trim()} currentProgress={progress} />

        {error && (
          <div className="error-message-container">
            <h3 className="type-title-medium">Operation Status</h3>
            {/* SAFE ERROR RENDERING: Ensures app doesn't crash on non-string errors */}
            {typeof error === 'string'
              ? error.split('\n').map((errMsg, index) => <p key={index}>{errMsg}</p>)
              : <p>{String(error)}</p>
            }
            <button onClick={() => setError(null)} className="btn error-dismiss-btn" aria-label="Dismiss message">Dismiss</button>
          </div>
        )}

        {comicPanels.length > 0 && !isLoading && (
          <div className="centered-action-button-container">
            <button onClick={handleDownloadPdf} disabled={isDownloadingPdf} className="btn btn-success" aria-label="Download Comic as PDF">
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
