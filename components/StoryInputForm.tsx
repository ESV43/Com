import React, { useState, useEffect, useCallback } from 'react';
import { StoryInputOptions, ComicStyle, ComicEra, AspectRatio, GenerationProgress, CaptionPlacement, GenerationService, CharacterReference } from '../types';
import {
  AVAILABLE_STYLES,
  AVAILABLE_ERAS,
  AVAILABLE_ASPECT_RATIOS,
  MAX_COMIC_PAGES,
  DEFAULT_NUM_PAGES,
  AVAILABLE_GEMINI_IMAGE_MODELS,
  DEFAULT_GEMINI_IMAGE_MODEL,
  AVAILABLE_GEMINI_TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  AVAILABLE_CAPTION_PLACEMENTS,
  DEFAULT_CAPTION_PLACEMENT,
  AVAILABLE_SERVICES,
  DEFAULT_POLLINATIONS_IMAGE_MODEL,
  DEFAULT_POLLINATIONS_TEXT_MODEL,
  MAX_CHARACTERS
} from '../constants';
import { listPollinationsImageModels, listPollinationsTextModels } from '../services/geminiService';

interface StoryInputFormProps {
  onSubmit: (options: StoryInputOptions) => void;
  isLoading: boolean;
  isApiKeyProvided: boolean;
  currentProgress?: GenerationProgress;
}

const StoryInputForm: React.FC<StoryInputFormProps> = ({ onSubmit, isLoading, isApiKeyProvided, currentProgress }) => {
  const [story, setStory] = useState('');
  const [style, setStyle] = useState<ComicStyle>(AVAILABLE_STYLES[0].value);
  const [era, setEra] = useState<ComicEra>(AVAILABLE_ERAS[0].value);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(AVAILABLE_ASPECT_RATIOS[0].value);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [numPages, setNumPages] = useState<number>(DEFAULT_NUM_PAGES);
  const [imageModel, setImageModel] = useState<string>(DEFAULT_GEMINI_IMAGE_MODEL);
  const [textModel, setTextModel] = useState<string>(DEFAULT_TEXT_MODEL);
  const [captionPlacement, setCaptionPlacement] = useState<CaptionPlacement>(DEFAULT_CAPTION_PLACEMENT);
  const [generationService, setGenerationService] = useState<GenerationService>(AVAILABLE_SERVICES[0].value);
  const [pollinationsImageModels, setPollinationsImageModels] = useState<{ value: string; label: string }[]>([]);
  const [pollinationsTextModels, setPollinationsTextModels] = useState<{ value: string; label: string }[]>([]);
  const [characterReferences, setCharacterReferences] = useState<CharacterReference[]>([]);
  const [arePollinationsModelsLoading, setArePollinationsModelsLoading] = useState(false);

  useEffect(() => {
    if (generationService === GenerationService.POLLINATIONS) {
      setArePollinationsModelsLoading(true);
      Promise.all([listPollinationsImageModels(), listPollinationsTextModels()])
        .then(([imageModels, textModels]) => {
          setPollinationsImageModels(imageModels);
          setPollinationsTextModels(textModels);
          setImageModel(imageModels.find(m => m.value === DEFAULT_POLLINATIONS_IMAGE_MODEL)?.value || imageModels[0]?.value);
          setTextModel(textModels.find(m => m.value === DEFAULT_POLLINATIONS_TEXT_MODEL)?.value || textModels[0]?.value);
        })
        .finally(() => setArePollinationsModelsLoading(false));
    } else {
      setTextModel(DEFAULT_TEXT_MODEL);
      setImageModel(DEFAULT_GEMINI_IMAGE_MODEL);
    }
  }, [generationService]);

  const handleAddCharacter = useCallback(() => {
    if (characterReferences.length < MAX_CHARACTERS) {
      setCharacterReferences(prev => [...prev, { id: Date.now(), name: '', imageDataUrl: '' }]);
    }
  }, [characterReferences.length]);

  const handleRemoveCharacter = useCallback((id: number) => {
    setCharacterReferences(prev => prev.filter(char => char.id !== id));
  }, []);

  const handleCharacterNameChange = useCallback((id: number, name: string) => {
    setCharacterReferences(prev => prev.map(char => char.id === id ? { ...char, name } : char));
  }, []);

  const handleCharacterImageChange = useCallback((id: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCharacterReferences(prev =>
          prev.map(char =>
            char.id === id ? { ...char, imageDataUrl: reader.result as string } : char
          )
        );
      };
      reader.onerror = (err) => {
        console.error("FileReader error:", err);
        alert("There was an error reading the image file.");
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (generationService === GenerationService.GEMINI && !isApiKeyProvided) {
      alert("Please enter your Gemini API Key above to use the Gemini service.");
      return;
    }
    if (!story.trim()) {
      alert("Please enter a story.");
      return;
    }
    onSubmit({ story, style, era, aspectRatio, includeCaptions, numPages, imageModel, textModel, captionPlacement, generationService, characterReferences });
  };

  const isSubmitDisabled = isLoading || (generationService === GenerationService.GEMINI && !isApiKeyProvided);

  return (
    <form onSubmit={handleSubmit} className="story-input-form-container">
      {/* Story Textarea - Unchanged */}
      <div className="form-group">
        <label htmlFor="story" className="form-label">Your Story:</label>
        <textarea
          id="story" value={story} onChange={(e) => setStory(e.target.value)}
          rows={8} className="form-textarea" placeholder="Type or paste your comic story here..."
          required minLength={50} maxLength={60000}
        />
        <p className="input-description">Min. 50 characters.</p>
      </div>

       <div className="form-group">
        <label htmlFor="generationService" className="form-label">AI Service:</label>
        <div className="form-select-wrapper">
          <select id="generationService" value={generationService} onChange={(e) => setGenerationService(e.target.value as GenerationService)} className="form-select">
            {AVAILABLE_SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Style and Era Grid - Unchanged */}
      <div className="form-group-grid">
        <div className="form-group">
          <label htmlFor="style" className="form-label">Comic Style:</label>
          <div className="form-select-wrapper">
            <select id="style" value={style} onChange={(e) => setStyle(e.target.value as ComicStyle)} className="form-select">
              {AVAILABLE_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="era" className="form-label">Comic Era:</label>
          <div className="form-select-wrapper">
            <select id="era" value={era} onChange={(e) => setEra(e.target.value as ComicEra)} className="form-select">
              {AVAILABLE_ERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      
      {/* Aspect Ratio and Num Pages Grid - Unchanged */}
      <div className="form-group-grid">
        <div className="form-group">
          <label htmlFor="aspectRatio" className="form-label">Image Aspect Ratio:</label>
          <div className="form-select-wrapper">
            <select id="aspectRatio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as AspectRatio)} className="form-select">
              {AVAILABLE_ASPECT_RATIOS.map(ar => <option key={ar.value} value={ar.value}>{ar.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="numPages" className="form-label">Number of Pages (1-{MAX_COMIC_PAGES})</label>
           <div className="form-input-container" style={{paddingTop: '0.25rem', paddingBottom:'0.25rem', borderRadius: 'var(--md-sys-shape-corner-extra-small)'}}>
            <input
              type="number" id="numPages" value={numPages}
              onChange={(e) => setNumPages(Math.max(1, Math.min(MAX_COMIC_PAGES, parseInt(e.target.value, 10) || 1)))}
              min="1" max={MAX_COMIC_PAGES} className="form-input" style={{paddingTop: '0.5rem', paddingBottom: '0.5rem'}}
            />
          </div>
        </div>
      </div>

      {/* DYNAMIC MODEL SELECTION */}
       <div className="form-group-grid">
        <div className="form-group">
            <label htmlFor="textModel" className="form-label">Text Generation Model:</label>
            <div className="form-select-wrapper">
              <select 
                id="textModel" value={textModel} onChange={(e) => setTextModel(e.target.value)} 
                className="form-select" disabled={arePollinationsModelsLoading}
              >
                { generationService === GenerationService.GEMINI && AVAILABLE_GEMINI_TEXT_MODELS.map(tm => <option key={tm.value} value={tm.value}>{tm.label}</option>) }
                { generationService === GenerationService.POLLINATIONS && (
                    arePollinationsModelsLoading ? <option>Loading models...</option> :
                    pollinationsTextModels.map(tm => <option key={tm.value} value={tm.value}>{tm.label}</option>)
                )}
              </select>
            </div>
          </div>
        <div className="form-group">
          <label htmlFor="imageModel" className="form-label">Image Generation Model:</label>
          <div className="form-select-wrapper">
            <select
              id="imageModel" value={imageModel} onChange={(e) => setImageModel(e.target.value)}
              className="form-select" disabled={arePollinationsModelsLoading}
            >
              { generationService === GenerationService.GEMINI && AVAILABLE_GEMINI_IMAGE_MODELS.map(im => <option key={im.value} value={im.value}>{im.label}</option>) }
              { generationService === GenerationService.POLLINATIONS && (
                    arePollinationsModelsLoading ? <option>Loading models...</option> :
                    pollinationsImageModels.map(im => <option key={im.value} value={im.value}>{im.label}</option>)
                )}
            </select>
          </div>
        </div>
      </div>
      
      {/* Captions Section - Unchanged */}
      <div className="form-group">
        <div className="checkbox-group" style={{marginBottom: '0.5rem'}}>
          <input
            id="includeCaptions" type="checkbox" checked={includeCaptions}
            onChange={(e) => setIncludeCaptions(e.target.checked)} className="checkbox-input"
          />
          <label htmlFor="includeCaptions" className="checkbox-label">Include Captions & Dialogues</label>
        </div>
        {includeCaptions && (
          <div className="form-group" style={{marginTop: '0.5rem', marginLeft: '1.5rem'}}>
            <label htmlFor="captionPlacement" className="form-label" style={{paddingLeft: 0, fontSize:'0.8rem'}}>Placement:</label>
            <div className="form-select-wrapper">
              <select
                id="captionPlacement" value={captionPlacement} onChange={(e) => setCaptionPlacement(e.target.value as CaptionPlacement)}
                className="form-select" disabled={!includeCaptions}
              >
                {AVAILABLE_CAPTION_PLACEMENTS.map(cp => <option key={cp.value} value={cp.value}>{cp.label}</option>)}
              </select>
            </div>
             <p className="input-description" style={{paddingLeft: 0, fontSize:'0.7rem'}}>Note: Embedding in image is experimental.</p>
          </div>
        )}
      </div>

      {/* CHARACTER CONSISTENCY */}
      <div className="form-group character-reference-section">
        <h3 className="type-title-medium">Character Consistency (Optional)</h3>
        <p className="input-description" style={{paddingLeft: 0, marginBottom: '1rem'}}>
          Add up to {MAX_CHARACTERS} characters to maintain their appearance across panels. Character names will be used to generate consistent faces and attire.
        </p>
        <div className="character-list">
          {characterReferences.map((char, index) => (
            <div key={char.id} className="character-item">
               <div className="character-inputs">
                <input
                  type="text"
                  placeholder={`Character ${index + 1} Name`}
                  value={char.name}
                  onChange={(e) => handleCharacterNameChange(char.id, e.target.value)}
                  className="form-input"
                  aria-label="Character Name"
                  />
                <div className="character-image-upload">
                    <label htmlFor={`char-img-${char.id}`} className="btn-file-label">
                        <span className="material-icons-outlined">upload_file</span>
                        {char.imageDataUrl ? 'Change Image' : 'Upload Image'}
                    </label>
                    <input
                        id={`char-img-${char.id}`}
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        onChange={(e) => handleCharacterImageChange(char.id, e)}
                        className="file-input-hidden"
                        />
                    {char.imageDataUrl && <img src={char.imageDataUrl} alt={`Preview ${char.name}`} className="character-preview-img" />}
                </div>
              </div>
               <button type="button" onClick={() => handleRemoveCharacter(char.id)} className="btn-icon-remove" aria-label="Remove Character">
                    <span className="material-icons-outlined">delete</span>
                </button>
            </div>
          ))}
        </div>
        {characterReferences.length < MAX_CHARACTERS && (
          <button type="button" onClick={handleAddCharacter} className="btn-add-character">
             <span className="material-icons-outlined">add</span>
            Add Character Reference
          </button>
        )}
      </div>


      <button
        type="submit" disabled={isSubmitDisabled}
        className="btn btn-primary btn-full-width"
        aria-label={isSubmitDisabled ? "API Key required for Gemini" : "Create My Comic!"}
      >
        <span className="material-icons-outlined">auto_awesome</span>
        {isLoading ? 'Generating Your Comic...' : 'Create My Comic!'}
      </button>
      {isSubmitDisabled && !isLoading && (
        <p className="input-description" style={{ textAlign: 'center', color: 'var(--md-sys-color-tertiary)'}}>
          Please enter your Gemini API Key to enable comic creation with Gemini.
        </p>
      )}
      {/* Progress Bar - Unchanged */}
      {isLoading && currentProgress && (
        <div className="form-progress-container">
          {/* ... progress bar jsx ... */}
        </div>
      )}
    </form>
  );
};

export default StoryInputForm;
