import React, { useState, useEffect } from 'react';
import { StoryInputOptions, ComicStyle, ComicEra, AspectRatio, GenerationProgress, CaptionPlacement, GenerationService, CharacterReference } from '../types';
import {
  AVAILABLE_STYLES,
  AVAILABLE_ERAS,
  AVAILABLE_ASPECT_RATIOS,
  MAX_COMIC_PAGES,
  DEFAULT_NUM_PAGES,
  MAX_CHARACTERS,
  AVAILABLE_GEMINI_IMAGE_MODELS,
  DEFAULT_GEMINI_IMAGE_MODEL,
  AVAILABLE_GEMINI_TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  AVAILABLE_CAPTION_PLACEMENTS,
  DEFAULT_CAPTION_PLACEMENT,
  AVAILABLE_SERVICES,
  DEFAULT_POLLINATIONS_IMAGE_MODEL,
  DEFAULT_POLLINATIONS_TEXT_MODEL
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
  const [characters, setCharacters] = useState<CharacterReference[]>([]);
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

  const handleAddCharacter = () => {
    if (characters.length < MAX_CHARACTERS) {
      setCharacters(prev => [...prev, { id: Date.now().toString(), name: '', file: null, imageDataUrl: null }]);
    }
  };

  const handleRemoveCharacter = (id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
  };

  const handleCharacterNameChange = (id: string, name: string) => {
    setCharacters(prev => prev.map(c => (c.id === id ? { ...c, name } : c)));
  };

  const handleCharacterImageChange = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setCharacters(prev => prev.map(c =>
          c.id === id ? { ...c, file, imageDataUrl: reader.result as string } : c
        ));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validCharacters = characters.filter(c => c.name.trim() && c.file && c.imageDataUrl);
    
    if ((generationService === GenerationService.GEMINI || validCharacters.length > 0) && !isApiKeyProvided) {
      alert("A Gemini API Key is required to use the Gemini service or the Character Reference feature.");
      return;
    }

    if (!story.trim()) {
      alert("Please enter a story.");
      return;
    }

    onSubmit({ story, style, era, aspectRatio, includeCaptions, numPages, imageModel, textModel, captionPlacement, generationService, characterReferences: validCharacters });
  };

  const isSubmitDisabled = isLoading || ((generationService === GenerationService.GEMINI || characters.some(c=>c.file)) && !isApiKeyProvided);

  return (
    <form onSubmit={handleSubmit} className="story-input-form-container">
      {/* Story Textarea */}
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

      {/* CHARACTER REFERENCE SECTION */}
      <div className="form-group character-reference-section">
        <label className="form-label" style={{ paddingLeft: 0, fontSize: '1rem', marginBottom: '1rem' }}>
          Character References (Optional)
        </label>
        <p className="input-description" style={{ paddingLeft: 0, marginTop: '-0.75rem', marginBottom: '1rem' }}>
          Add characters for consistency. <b>A Gemini API Key is required for this feature</b> to analyze the images, even when using Pollinations.
        </p>
        <div className="character-inputs-container">
          {characters.map((char, index) => (
            <div key={char.id} className="character-input-group">
              <div className="character-image-preview">
                {char.imageDataUrl ? (
                  <img src={char.imageDataUrl} alt={`Preview for ${char.name || 'character'}`} />
                ) : (
                  <div className="character-image-placeholder">
                    <span className="material-icons-outlined">add_photo_alternate</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  className="character-image-input"
                  onChange={(e) => handleCharacterImageChange(char.id, e)}
                  aria-label={`Upload image for character ${index + 1}`}
                />
              </div>
              <div className="character-details">
                <input
                  type="text"
                  value={char.name}
                  onChange={(e) => handleCharacterNameChange(char.id, e.target.value)}
                  placeholder={`Character ${index + 1} Name`}
                  className="form-input"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveCharacter(char.id)}
                  className="btn-remove-char"
                  aria-label={`Remove character ${index + 1}`}
                >
                  <span className="material-icons-outlined">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        {characters.length < MAX_CHARACTERS && ( <button type="button" onClick={handleAddCharacter} className="btn btn-tertiary" style={{marginTop: '1rem'}}> <span className="material-icons-outlined">add</span> Add Character </button> )}
      </div>

      {/* Other form groups remain the same... */}
      
    </form>
  );
};

export default StoryInputForm;
