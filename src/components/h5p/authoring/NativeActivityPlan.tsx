import type { AuthoringSession } from '../../../services/api';

export default function NativeActivityPlan({ plan }: { plan: NonNullable<AuthoringSession['nativePlan']> }) {
  return <div className="authoring-plan">
    <div className="authoring-section-heading"><span className="authoring-kicker">NATIVE ACTIVITY PLAN</span></div>
    <h3>{plan.title}</h3><p>{plan.brief}</p>
    <p>{plan.materialIds.length} selected materials · {plan.objectiveIds.length} selected learning objectives</p>
    <p>This creates an independent Studio activity. Review its brief and type, or ask for changes in the conversation before generating.</p>
  </div>;
}
