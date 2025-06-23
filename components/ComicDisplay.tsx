
import React from 'react';
import { ComicPanelData, AspectRatio } from '../types';
import Panel from './Panel';

interface ComicDisplayProps {
  panels: ComicPanelData[];
  aspectRatioSetting: AspectRatio;
}

const ComicDisplay: React.FC<ComicDisplayProps> = ({ panels, aspectRatioSetting }) => {
  if (!panels || panels.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--md-sys-color-on-surface-variant)' }}>
        <p className="type-title-large">Your comic will appear here.</p>
        <p className="type-body-medium">Fill out the form above and click "Create My Comic!"</p>
      </div>
    );
  }

  return (
    <div className="comic-display-container">
      <h2 className="type-headline-medium comic-display-title">Your Generated Comic</h2>
      <div className="comic-grid">
        {panels.map((panel) => (
          <Panel key={panel.scene_number} panel={panel} aspectRatioSetting={aspectRatioSetting} />
        ))}
      </div>
    </div>
  );
};

export default ComicDisplay;
