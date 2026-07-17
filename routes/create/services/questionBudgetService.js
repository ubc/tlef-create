const HIGHER_ORDER_BLOOM_LEVELS = new Set(['apply', 'analyze', 'evaluate', 'create']);
const MAX_QUESTIONS_PER_LO = 5;

function normalizeMetadata(learningObjective) {
  return learningObjective?.generationMetadata || {};
}

function getSubpoints(learningObjective) {
  const subpoints = normalizeMetadata(learningObjective).subpoints;
  return Array.isArray(subpoints)
    ? [...new Set(subpoints.map(point => String(point).trim()).filter(Boolean))]
    : [];
}

function estimateLOQuestionCount(learningObjective, approach) {
  const metadata = normalizeMetadata(learningObjective);
  const subpoints = getSubpoints(learningObjective);
  const bloomLevel = String(metadata.bloomLevel || '').toLowerCase();

  // One question can usually sample one or two closely related subpoints.
  const coverageCount = subpoints.length > 0
    ? Math.max(1, Math.ceil(subpoints.length / 2))
    : 1;
  const bloomBonus = HIGHER_ORDER_BLOOM_LEVELS.has(bloomLevel) ? 1 : 0;
  const approachBonus = (
    (approach === 'support' && subpoints.length >= 3)
    || (approach === 'gamify' && subpoints.length >= 2)
  ) ? 1 : 0;
  const count = Math.min(MAX_QUESTIONS_PER_LO, coverageCount + bloomBonus + approachBonus);

  const reasons = [
    subpoints.length
      ? `${subpoints.length} subpoint${subpoints.length === 1 ? '' : 's'}`
      : 'base learning-objective coverage',
    bloomBonus ? `${bloomLevel} requires higher-order evidence` : null,
    approachBonus ? `${approach} benefits from an additional practice interaction` : null
  ].filter(Boolean);

  return {
    count,
    subpointCount: subpoints.length,
    subpoints,
    bloomLevel: bloomLevel || undefined,
    rationale: reasons.join('; ')
  };
}

function scaleAllocationsToTotal(allocations, requestedTotal) {
  if (!allocations.length) return [];
  if (requestedTotal < allocations.length) {
    throw new Error(`Question total must be at least ${allocations.length} so every learning objective is covered.`);
  }

  const baseline = allocations.map(allocation => ({ ...allocation, count: 1 }));
  let remaining = requestedTotal - baseline.length;
  if (remaining === 0) return baseline;

  const weights = allocations.map(allocation => Math.max(1, allocation.count));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight, index) => {
    const exact = totalWeight > 0 ? (remaining * weight) / totalWeight : remaining / weights.length;
    const whole = Math.floor(exact);
    baseline[index].count += whole;
    return { index, remainder: exact - whole };
  });

  remaining -= baseline.reduce((sum, allocation) => sum + allocation.count, 0) - baseline.length;
  shares
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, remaining)
    .forEach(({ index }) => {
      baseline[index].count += 1;
    });

  return baseline;
}

export function buildQuestionBudget(learningObjectives = [], options = {}) {
  const approach = options.approach || 'support';
  const maxQuestions = options.maxQuestions || 100;
  const requestedTotal = Number.isFinite(options.requestedTotal) ? options.requestedTotal : null;

  const rawAllocations = learningObjectives.map((learningObjective, index) => ({
    learningObjectiveIndex: index,
    learningObjectiveId: learningObjective?._id?.toString?.() || learningObjective?._id,
    learningObjectiveText: learningObjective?.text || '',
    ...estimateLOQuestionCount(learningObjective, approach)
  }));

  const rawTotal = rawAllocations.reduce((sum, allocation) => sum + allocation.count, 0);
  const effectiveTotal = requestedTotal ?? Math.min(maxQuestions, rawTotal);
  const allocations = effectiveTotal === rawTotal
    ? rawAllocations
    : scaleAllocationsToTotal(rawAllocations, effectiveTotal);
  const total = allocations.reduce((sum, allocation) => sum + allocation.count, 0);

  return {
    method: 'lo-subpoint-budget-v1',
    approach,
    total,
    requestedTotal,
    allocations,
    rationale: requestedTotal === null
      ? `CREATE recommends ${total} questions from ${learningObjectives.length} learning objectives, their subpoint breadth, Bloom levels, and the ${approach} teaching purpose.`
      : `The instructor requested ${total} questions; CREATE distributed them across learning objectives according to subpoint breadth and Bloom level.`
  };
}

/**
 * Keep only model-generated rows that reference learning objectives in the
 * authoritative budget. The caller can then rebalance missing coverage.
 */
export function discardPlanItemsOutsideBudget(planItems = [], budget) {
  const allowedIndexes = new Set(
    (budget?.allocations || []).map(allocation => allocation.learningObjectiveIndex)
  );
  const items = [];
  const discardedIndexes = [];

  for (const rawItem of planItems) {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const rawIndex = item.learningObjectiveIndex;
    const normalizedIndex = typeof rawIndex === 'string'
      ? Number(rawIndex.trim())
      : rawIndex;

    if (!Number.isInteger(normalizedIndex) || !allowedIndexes.has(normalizedIndex)) {
      discardedIndexes.push(rawIndex);
      continue;
    }

    items.push({ ...item, learningObjectiveIndex: normalizedIndex });
  }

  return {
    items,
    discardedIndexes: [...new Set(discardedIndexes.map(index => String(index)))]
  };
}

export function alignPlanItemsToSubpoints(planItems = [], learningObjectives = []) {
  const totalByLO = planItems.reduce((totals, item) => {
    totals[item.learningObjectiveIndex] = (totals[item.learningObjectiveIndex] || 0) + item.count;
    return totals;
  }, {});
  const focusGroupsByLO = new Map();
  const cursors = new Map();
  const alignedItems = [];

  for (let itemIndex = 0; itemIndex < planItems.length; itemIndex++) {
    const item = planItems[itemIndex];
    const learningObjective = learningObjectives[item.learningObjectiveIndex];
    const subpoints = getSubpoints(learningObjective);
    if (!subpoints.length) {
      alignedItems.push(item);
      continue;
    }

    if (!focusGroupsByLO.has(item.learningObjectiveIndex)) {
      const groupCount = Math.min(totalByLO[item.learningObjectiveIndex], subpoints.length);
      const groups = [];
      let offset = 0;

      for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const remainingSubpoints = subpoints.length - offset;
        const remainingGroups = groupCount - groupIndex;
        const groupSize = Math.ceil(remainingSubpoints / remainingGroups);
        groups.push(subpoints.slice(offset, offset + groupSize));
        offset += groupSize;
      }

      focusGroupsByLO.set(item.learningObjectiveIndex, groups);
    }

    const focusGroups = focusGroupsByLO.get(item.learningObjectiveIndex);
    const cursor = cursors.get(item.learningObjectiveIndex) || 0;
    const itemGroups = new Map();

    for (let unitIndex = 0; unitIndex < item.count; unitIndex++) {
      const focusGroupIndex = (cursor + unitIndex) % focusGroups.length;
      const subpointGroup = focusGroups[focusGroupIndex];
      const focusArea = subpointGroup.join('; ');
      const key = `${itemIndex}-${focusGroupIndex}`;
      const existing = itemGroups.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        const rationalePrefix = item.rationale ? `${item.rationale} ` : '';
        itemGroups.set(key, {
          ...item,
          count: 1,
          focusArea,
          rationale: `${rationalePrefix}Focused on LO subpoints: ${focusArea}`.slice(0, 1000)
        });
      }
    }

    alignedItems.push(...itemGroups.values());
    cursors.set(item.learningObjectiveIndex, (cursor + item.count) % focusGroups.length);
  }

  return alignedItems;
}

export function rebalancePlanToBudget(planItems = [], budget, fallbackType = 'multiple-choice', approach = 'support') {
  const rebalanced = planItems.map(item => ({ ...item }));

  for (const allocation of budget.allocations) {
    let indices = rebalanced
      .map((item, index) => item.learningObjectiveIndex === allocation.learningObjectiveIndex ? index : -1)
      .filter(index => index >= 0);

    if (indices.length === 0) {
      rebalanced.push({
        type: fallbackType,
        learningObjectiveIndex: allocation.learningObjectiveIndex,
        count: allocation.count,
        pedagogicalIntent: approach,
        bloomLevel: allocation.bloomLevel || 'understand',
        difficulty: HIGHER_ORDER_BLOOM_LEVELS.has(allocation.bloomLevel) ? 'hard' : 'moderate',
        focusArea: allocation.subpoints[0] || `Core coverage for LO ${allocation.learningObjectiveIndex + 1}`,
        rationale: `Added from the deterministic LO budget: ${allocation.rationale}.`
      });
      continue;
    }

    while (indices.length > allocation.count) {
      rebalanced.splice(indices.pop(), 1);
      indices = rebalanced
        .map((item, index) => item.learningObjectiveIndex === allocation.learningObjectiveIndex ? index : -1)
        .filter(index => index >= 0);
    }

    let currentTotal = indices.reduce((sum, index) => sum + rebalanced[index].count, 0);
    if (currentTotal > allocation.count) {
      let excess = currentTotal - allocation.count;
      for (let position = indices.length - 1; position >= 0 && excess > 0; position--) {
        const item = rebalanced[indices[position]];
        const removable = Math.min(item.count - 1, excess);
        item.count -= removable;
        excess -= removable;
      }
    } else if (currentTotal < allocation.count) {
      let missing = allocation.count - currentTotal;
      let position = 0;
      while (missing > 0) {
        rebalanced[indices[position % indices.length]].count += 1;
        missing -= 1;
        position += 1;
      }
    }
  }

  return rebalanced.filter(item => budget.allocations.some(
    allocation => allocation.learningObjectiveIndex === item.learningObjectiveIndex
  ));
}

export default {
  buildQuestionBudget,
  discardPlanItemsOutsideBudget,
  alignPlanItemsToSubpoints,
  rebalancePlanToBudget
};
