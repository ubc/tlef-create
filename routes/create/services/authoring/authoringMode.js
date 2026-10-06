// The saved conversation mode also records an instructor's current build
// intent. Only this turn can change it; old briefs never reauthorize a build.
export function requestedAuthoringMode(input) {
  const text = String(input || '');
  let mode = null;
  let buildTarget = null;
  // A correction can reject one draft and request another in the same turn.
  // Negated actions never match the positive action in their own clause.
  for (const clause of text.split(/[,.!?，。！？;；\n]|\bbut\b|但是/i)) {
    // Withdrawing a specifically identified earlier plan/change does not
    // withdraw a separate current construction request. This narrow clause
    // check never supplies build intent by itself or ignores a global stop.
    const deferredPriorAction = /^(?:请)?(?:旧|此前|之前|先前|原先|原来|某项|这项|那项|该项)[^。！？\n]{0,60}(?:修改|变更|更新|调整|指令|计划)(?:也|都|就)?(?:先不要|暂不|暂缓|不要)(?:执行|实施|应用|处理|继续|构建|生成|制作)?(?:了)?$|^(?:请)?(?:先不要|暂不|暂缓|不要)(?:执行|实施|应用|处理|继续|构建|生成|制作)(?:旧|此前|之前|先前|原先|原来|某项|这项|那项|该项)[^。！？\n]{0,60}(?:修改|变更|更新|调整|指令|计划)$/i;
    if (deferredPriorAction.test(clause.trim())) continue;
    // Deferring questions still permits an explicitly requested activity or
    // reviewable teaching plan. It cannot authorize construction on its own,
    // or override a contradiction about generating the questions themselves.
    const questionDeferral = /\b(?:do not|don't)\s+(?:(?:you|we)\s+)?(?:create|build|generate|make|draft|prepare)\s+(?:(?:any|new|the|more)\s+|\d+\s*)?(?:questions?|quizzes|quiz)\b|(?:不要|不|别)(?:生成|出|创建|构建|制作|设计)(?:任何|新的|新|更多)?(?:\d+\s*(?:道|个)?\s*)?(?:题目|试题|题|问题|测验)/gi;
    const defersQuestions = questionDeferral.test(clause);
    const construction = clause.replace(questionDeferral, '');
    if (/(?:\b(?:do not|don't)\s+(?:(?:you|we)\s+)?(?:create|build|generate|make|draft|prepare|propose)(?:\b|(?=\d))|\bnot yet\b|before (?:you |we )?(?:build|generat)|\b(?:only|just)\s+(?:discuss|explore|brainstorm|talk)\b|先不要|(?:不要|不|别)(?:生成|出题|创建|构建|制作|拟定|设计)|暂不|(?:只|仅|先)(?:想)?(?:讨论|聊聊|探索)|先聊)/i.test(construction)) {
      mode = 'explore';
      buildTarget = null;
      continue;
    }
    if (/(?:\b(?:how|why|whether|what if)\b[^.!?\n]{0,80}\b(?:create|build|generate|make|draft|prepare|propose)(?:\b|(?=\d)))|(?:如何|怎么|怎样|是否|假如)[^。！？\n]{0,40}(?:生成|创建|构建|制作|出题|拟定|设计)/i.test(construction)) continue;
    // Direct construction requests also cover native types supplied by the
    // capability catalog; this intent boundary must not maintain a type list.
    const requestsBuild = /^(?:(?:please|can you|could you|help me|i (?:want|would like) (?:you )?to)\s+)?(?:create|build|generate|make|draft|prepare|propose)\s+\S|^(?:请|帮我|我想|我希望|现在)?(?:生成|创建|构建|制作|拟定|设计)\S/i.test(construction.trim())
      || /(?:\b(?:create|build|generate|make|draft|prepare|propose)\b[^.!?\n]{0,100}\b(?:questions?|quiz|activity|activities|plan|objectives?)\b)|(?:\b(?:create|build|generate|make|draft|prepare|propose)\s*\d+\b)|出题|(?:生成|创建|构建|制作|拟定|设计)[^。！？\n]{0,40}(?:题|活动|计划|学习目标)|^(?:请)?(?:先)?(?:给我?|提供|提出)[^。！？\n]{0,30}(?:教学计划|活动计划|学习目标)/i.test(construction.trim());
    if (requestsBuild) {
      mode = 'build';
      buildTarget = /\b(?:questions?|quizzes|quiz)\b|\b(?:create|build|generate|make|draft|prepare|propose)\s*\d+\b|题目|试题|出题|(?:生成|创建|构建|制作|拟定|设计)[^。！？\n]{0,8}题/i.test(construction) ? 'questions' : 'activity';
    }
    if (defersQuestions && !(mode === 'build' && buildTarget === 'activity')) {
      mode = 'explore';
      buildTarget = null;
    }
  }
  return mode;
}

export function authoringModeForRequest(currentMode, latestRequest, explicitMode) {
  const requested = requestedAuthoringMode(latestRequest);
  // A deferral revokes even build mode. An explicit stage selection takes
  // precedence over a build mention in this message.
  return requested === 'explore' ? 'explore' : explicitMode || requested || currentMode || 'build';
}

export function authorizesAgentBuild(session, latestRequest, explicitMode) {
  if (requestedAuthoringMode(latestRequest) === 'explore' || explicitMode === 'explore') return false;
  return session.mode !== 'explore' || requestedAuthoringMode(latestRequest) === 'build';
}
