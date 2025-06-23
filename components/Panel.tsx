
import React from 'react';
import { ComicPanelData, AspectRatio } from '../types';

interface PanelProps {
  panel: ComicPanelData;
  aspectRatioSetting: AspectRatio;
}

const Panel: React.FC<PanelProps> = ({ panel, aspectRatioSetting }) => {
  let aspectRatioClass = 'aspect-square'; 
  if (aspectRatioSetting === AspectRatio.PORTRAIT) {
    aspectRatioClass = 'aspect-portrait';
  } else if (aspectRatioSetting === AspectRatio.LANDSCAPE) {
    aspectRatioClass = 'aspect-landscape';
  }
  
  return (
    <div className="comic-panel">
      <div className={`panel-image-wrapper ${aspectRatioClass}`}>
        {panel.imageUrl && panel.imageUrl !== 'error' ? (
          <img 
            src={panel.imageUrl} 
            alt={`Comic panel ${panel.scene_number}`} 
            className="panel-image" 
          />
        ) : panel.imageUrl === 'error' ? (
           <div className="panel-image-placeholder">
            <span className="material-icons-outlined" style={{color: 'var(--md-sys-color-error)'}}>error_outline</span>
            <span>Image Error</span>
          </div>
        ) : (
          <div className="panel-image-placeholder">
            <span className="material-icons-outlined">hourglass_empty</span>
            <span>Generating...</span>
          </div>
        )}
      </div>
      {(panel.caption || (panel.dialogues && panel.dialogues.length > 0)) && (
        <div className="panel-content">
          {panel.caption && (
            <p className="panel-caption">
              <strong>Scene {panel.scene_number}:</strong> {panel.caption}
            </p>
          )}
          {panel.dialogues && panel.dialogues.length > 0 && (
            <div className="panel-dialogues">
              {panel.dialogues.map((dialogue, index) => (
                <p key={index} className="panel-dialogue">
                  {dialogue}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
       {!panel.caption && (!panel.dialogues || panel.dialogues.length === 0) && (
         <div className="panel-scene-number-only">
            <p>Scene {panel.scene_number}</p>
         </div>
       )}
    </div>
  );
};

export default Panel;
