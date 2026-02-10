import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const LOADING_STEPS = [
  'Analyzing learning objectives...',
  'Distributing questions across objectives...',
  'Optimizing question type mix...'
];

export default function AILoadingAnimation() {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep(prev => (prev + 1) % LOADING_STEPS.length);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ai-loading-animation">
      <div className="ai-loading-spinner">
        <Loader2 size={48} className="spinning" />
      </div>
      <div className="ai-loading-steps">
        {LOADING_STEPS.map((step, idx) => (
          <div
            key={idx}
            className={`ai-loading-step ${idx === currentStep ? 'active' : ''} ${idx < currentStep ? 'completed' : ''}`}
          >
            <span className="step-bullet"></span>
            <span className="step-text">{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
