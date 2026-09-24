import { useId } from 'react';
import { Check, Sparkles, Target, Trophy } from 'lucide-react';
import {
  DELIVERY_TARGETS, getFormatsForDeliveryTarget,
  type DeliveryTarget, type PedagogicalApproach, type TargetFormat
} from '../../constants/questionTypeCapabilities';
import '../../styles/components/GenerationSetup.css';

const STREAMS = [
  { value: 'assess' as const, label: 'ASSESS', title: 'Assess understanding', icon: Target, description: 'Check what students know with questions, answers and feedback.' },
  { value: 'support' as const, label: 'SUPPORT', title: 'Support learning', icon: Sparkles, description: 'Help students practise, recall and make sense of key concepts.' },
  { value: 'gamify' as const, label: 'GAMIFY', title: 'Gamify learning', icon: Trophy, description: 'Build engagement through matching, ordering and playful practice.' }
];

const LAYOUT_COPY: Record<TargetFormat, { caption: string; detail: string }> = {
  'question-set': { caption: 'A sequence of questions', detail: 'Students move through questions, then see their score and feedback.' },
  'interactive-book': { caption: 'Chapters and pages', detail: 'Students use a chapter menu to explore a structured, multi-page activity.' },
  column: { caption: 'One scrolling page', detail: 'Students scroll through text and mixed activities stacked vertically.' },
  standalone: { caption: 'One focused activity', detail: 'A dedicated player for a Branching Scenario, crossword, or paragraph-sorting task.' },
  'mixed-activity': { caption: 'CREATE’s Canvas player', detail: 'Students launch a mixed activity from Canvas through LTI, rather than a standard H5P container.' }
};

/** Schematic layout examples, not generated content or a live H5P player. */
export function LayoutPreview({ format }: { format: TargetFormat }) {
  return (
    <svg className="generation-layout-preview" viewBox="0 0 240 142" aria-hidden="true" focusable="false">
      <rect className="layout-frame" x="1" y="1" width="238" height="140" rx="8" />
      {format === 'question-set' ? <>
        <path className="layout-line" d="M20 22h95" />
        {[0, 1, 2, 3].map(i => <circle key={i} className={i === 0 ? 'layout-ink' : 'layout-muted'} cx={174 + i * 13} cy="22" r="3" />)}
        <rect className="layout-panel" x="18" y="39" width="204" height="70" rx="4" />
        <path className="layout-line" d="M32 52h130" />
        {[68, 84, 100].map(y => <g key={y}><circle className="layout-outline" cx="35" cy={y} r="3" /><path className="layout-line" d={`M47 ${y}h105`} /></g>)}
        <rect className="layout-muted" x="18" y="120" width="30" height="7" rx="3" />
        <rect className="layout-ink" x="184" y="118" width="38" height="12" rx="3" />
      </> : format === 'interactive-book' ? <>
        <rect className="layout-panel" x="10" y="10" width="63" height="122" rx="4" />
        <rect className="layout-ink" x="17" y="20" width="49" height="14" rx="3" />
        {[48, 67, 86].map(y => <path key={y} className="layout-line" d={`M20 ${y}h41`} />)}
        <path className="layout-line" d="M87 24h115" />
        <rect className="layout-panel" x="85" y="40" width="141" height="34" rx="4" />
        <rect className="layout-panel" x="85" y="83" width="141" height="31" rx="4" />
        <path className="layout-line" d="M181 126h34" />
      </> : format === 'column' || format === 'mixed-activity' ? <>
        <path className="layout-line" d="M32 20h105" />
        {[32, 65, 98].map((y, i) => <g key={y}>
          <rect className="layout-panel" x="30" y={y} width="175" height="27" rx="4" />
          <rect className={i === 1 ? 'layout-ink' : 'layout-muted'} x="39" y={y + 8} width="16" height="11" rx="2" />
          <path className="layout-line" d={`M66 ${y + 13}h99`} />
        </g>)}
        <path className="layout-line" d="M220 32v78m-4-5 4 5 4-5" />
      </> : <>
        <path className="layout-line" d="M39 20h100" />
        <rect className="layout-panel" x="24" y="34" width="192" height="95" rx="5" />
        {[0, 1, 2, 3].map(row => [0, 1, 2, 3].map(col => <rect key={`${row}-${col}`} className={(row + col) % 3 === 0 ? 'layout-ink' : 'layout-outline'} x={89 + col * 17} y={49 + row * 17} width="14" height="14" rx="2" />))}
      </>}
    </svg>
  );
}

interface Props {
  approach: PedagogicalApproach;
  onApproachChange: (approach: PedagogicalApproach) => void;
  deliveryTarget: DeliveryTarget;
  targetFormat: TargetFormat;
  onDeliveryTargetChange: (target: DeliveryTarget) => void;
  onTargetFormatChange: (format: TargetFormat) => void;
  disabled?: boolean;
}

export default function GenerationSetup({ approach, onApproachChange, deliveryTarget, targetFormat, onDeliveryTargetChange, onTargetFormatChange, disabled = false }: Props) {
  const id = useId();
  return (
    <section className="generation-setup" aria-label="Teaching purpose and activity layout">
      <fieldset className="generation-setup-section" disabled={disabled}>
        <legend>Choose your teaching purpose</legend>
        <p className="generation-setup-hint">What should this Quiz help your students do?</p>
        <div className="pedagogical-streams">
          {STREAMS.map(stream => <label key={stream.value} className="pedagogical-stream">
            <input className="generation-choice-input" type="radio" name={`${id}-stream`} value={stream.value} checked={approach === stream.value} onChange={() => onApproachChange(stream.value)} aria-label={stream.label} />
            <span className="pedagogical-stream-body">
              <span className="generation-choice-top"><stream.icon size={20} aria-hidden="true" /><strong>{stream.label}</strong><Check className="generation-choice-check" size={16} aria-hidden="true" /></span>
              <span className="generation-choice-title">{stream.title}</span>
              <span className="generation-choice-detail">{stream.description}</span>
            </span>
          </label>)}
        </div>
      </fieldset>

      <section className="generation-setup-section">
        <h3>Choose the student-facing layout</h3>
        <p className="generation-setup-hint">Pick how students will move through the activity. These illustrations show the layout, not your generated content.</p>
        <fieldset className="generation-delivery" disabled={disabled}>
          <legend>Delivery target</legend>
          {DELIVERY_TARGETS.map(target => <label key={target.value}>
            <input type="radio" name={`${id}-delivery`} value={target.value} checked={deliveryTarget === target.value} onChange={() => onDeliveryTargetChange(target.value)} />
            {target.label}
          </label>)}
        </fieldset>
        <fieldset className="generation-layouts" disabled={disabled}>
          <legend className="generation-visually-hidden">{deliveryTarget === 'canvas-lti' ? 'Canvas LTI layout' : 'H5P package layout'}</legend>
          <div className={`generation-layout-grid ${deliveryTarget === 'canvas-lti' ? 'is-canvas' : ''}`}>
            {getFormatsForDeliveryTarget(deliveryTarget).map((format, index) => <label key={format.value} className="generation-layout-choice">
              <input className="generation-choice-input" type="radio" name={`${id}-layout`} value={format.value} checked={targetFormat === format.value} onChange={() => onTargetFormatChange(format.value)} aria-label={format.label} aria-describedby={`${id}-${format.value}-description`} />
              <span className="generation-layout-body">
                <LayoutPreview format={format.value} />
                <span className="generation-choice-top"><span className="generation-layout-order" aria-hidden="true">{index + 1}</span><strong>{format.label}</strong><Check className="generation-choice-check" size={16} aria-hidden="true" /></span>
                <span className="generation-layout-caption">{LAYOUT_COPY[format.value].caption}</span>
                <span className="generation-choice-detail" id={`${id}-${format.value}-description`}>{LAYOUT_COPY[format.value].detail}</span>
              </span>
            </label>)}
          </div>
        </fieldset>
        <p className="generation-layout-note">{deliveryTarget === 'h5p-package' ? 'H5P layouts support different question types. CREATE checks compatibility before applying a change.' : 'Canvas LTI uses CREATE’s Mixed Activity player. The four H5P package layouts apply only to H5P downloads.'}</p>
      </section>
    </section>
  );
}
