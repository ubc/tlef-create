import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import '../../styles/components/FeatureCoachmark.css';

type CoachmarkPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

interface FeatureCoachmarkProps {
  children: ReactNode;
  isOpen: boolean;
  title: string;
  description: string;
  eyebrow?: string;
  primaryLabel?: string;
  placement?: CoachmarkPlacement;
  block?: boolean;
  onPrimary: () => void;
  onDismiss: () => void;
  onSkip: () => void;
}

const VIEWPORT_GUTTER = 16;
const POPOVER_GAP = 12;

const FeatureCoachmark = ({
  children,
  isOpen,
  title,
  description,
  eyebrow = 'Quick tour',
  primaryLabel = 'Got it',
  placement = 'bottom-start',
  block = false,
  onPrimary,
  onDismiss,
  onSkip
}: FeatureCoachmarkProps) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || !isOpen) {
      setIsVisible(false);
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [isOpen]);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const alignEnd = placement.endsWith('end');
    const preferTop = placement.startsWith('top');
    const roomBelow = window.innerHeight - anchorRect.bottom;
    const showAbove = preferTop || roomBelow < popoverRect.height + POPOVER_GAP + VIEWPORT_GUTTER;

    const desiredLeft = alignEnd
      ? anchorRect.right - popoverRect.width
      : anchorRect.left;
    const left = Math.min(
      Math.max(desiredLeft, VIEWPORT_GUTTER),
      window.innerWidth - popoverRect.width - VIEWPORT_GUTTER
    );
    const top = showAbove
      ? anchorRect.top - popoverRect.height - POPOVER_GAP
      : anchorRect.bottom + POPOVER_GAP;

    setPosition({
      top: Math.max(VIEWPORT_GUTTER, top),
      left
    });
  }, [placement]);

  useLayoutEffect(() => {
    if (!isOpen || !isVisible) return;
    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, isVisible, updatePosition]);

  return (
    <div
      ref={anchorRef}
      className={`feature-coachmark-anchor${block ? ' feature-coachmark-anchor--block' : ''}${isOpen ? ' is-tutorial-active' : ''}`}
    >
      {children}
      {isOpen && isVisible && createPortal(
        <div
          ref={popoverRef}
          className="feature-coachmark"
          role="dialog"
          aria-label={title}
          style={{ top: position.top, left: position.left }}
        >
          <button className="feature-coachmark__close" onClick={onDismiss} aria-label="Dismiss tutorial">
            <X size={16} />
          </button>
          <div className="feature-coachmark__eyebrow">
            <Sparkles size={14} /> {eyebrow}
          </div>
          <h3>{title}</h3>
          <p>{description}</p>
          <div className="feature-coachmark__actions">
            <button className="btn btn-primary btn-sm" onClick={onPrimary}>{primaryLabel}</button>
            <button className="feature-coachmark__skip" onClick={onSkip}>Skip tutorials</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default FeatureCoachmark;
