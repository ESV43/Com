
import React from 'react';
import { GenerationProgress } from '../types';

interface LoadingSpinnerProps {
  progress?: GenerationProgress;
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ progress, message }) => {
  return (
    <div className="loading-overlay">
      <div className="loading-spinner"></div>
      {message && <p className="loading-message">{message}</p>}
      {progress && (
        <div className="loading-progress-info">
          <p className="loading-progress-step">{progress.currentStep}</p>
          {progress.currentPanel !== undefined && progress.totalPanels !== undefined && (
            <p className="loading-progress-panel-info">
              Panel {progress.currentPanel} of {progress.totalPanels}
            </p>
          )}
          <div className="loading-progress-bar-container">
            <div
              className="loading-progress-bar"
              style={{ width: `${progress.percentage}%` }}
            ></div>
          </div>
          <p className="loading-progress-percentage">{Math.round(progress.percentage)}% Complete</p>
        </div>
      )}
      {!progress && !message && <p className="loading-message">Loading...</p>}
    </div>
  );
};

export default LoadingSpinner;
