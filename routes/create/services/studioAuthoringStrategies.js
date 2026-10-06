import { buildStudioJSONContract } from './h5pStudioSemantics.js';
import { documentationAuthoringGuidance, documentationOutputSchema } from './studioDocumentationContract.js';

const error = (message, code = 'H5P_AI_INPUT', status = 400) => {
  throw Object.assign(new Error(message), { code, status });
};
const machineName = library => String(library || '').split(' ')[0];
const requests = (instructions, pattern) => [...String(instructions || '').matchAll(pattern)].some(match => {
  const clause = String(instructions || '').slice(Math.max(0, match.index - 60), match.index).split(/[.!?。！？;\n]/).at(-1) || '';
  return !/(?:\b(?:do not|don't|without|avoid|exclude|no)\b(?:\s+\w+){0,3}\s*|(?:不要|不需要|避免|无需)\s*)$/i.test(clause);
});
const requestsWordExport = instructions => requests(instructions,
  /(?:export|download|导出|下载).{0,50}(?:Word|docx|\.doc\b)|(?:Word|docx|\.doc\b).{0,50}(?:export|download|导出|下载)/gi);

/** The ordinary native strategy is derived from installed H5P semantics. It
 * adds no second collection of type definitions, field schemas or defaults. */
export const semanticsAuthoringStrategy = Object.freeze({
  id: 'installed-semantics',
  guidance: 'Follow the installed H5P parameter schema and preserve trusted template media.',
  buildContract({ library, libraries, templateParameters, trustedMedia = new Map() }) {
    return {
      paramsSchema: buildStudioJSONContract(library, libraries, templateParameters, trustedMedia),
      outputSchema: null, guidance: [], contractVersion: 1
    };
  },
  validateRequest({ instructions }) {
    if (requestsWordExport(instructions)) {
      error('This H5P type cannot export all learner answers to a Word document. Use Documentation Tool for written responses, or remove the Word-export step from this activity.');
    }
  },
  postValidate({ parameters }) { return parameters; }
});

export const documentationAuthoringStrategy = Object.freeze({
  id: 'documentation-pages',
  guidance: 'Native reading, written responses, goals and export pages. Scored multiple-choice pages are unsupported.',
  buildContract(context) {
    const contract = semanticsAuthoringStrategy.buildContract(context);
    return { ...contract,
      outputSchema: context.templateParameters == null && !context.template ? documentationOutputSchema : null,
      guidance: [documentationAuthoringGuidance]
    };
  },
  validateRequest({ instructions }) {
    if (requests(instructions, /\bmultiple[\s-]?choice\b|\bMCQs?\b|选择题/gi)) {
      error('Documentation Tool cannot contain multiple-choice questions. Use Question Set or Column for those questions. For a Word export of written responses, use Documentation Tool without the multiple-choice step.');
    }
  },
  postValidate({ instructions, parameters }) {
    if (requestsWordExport(instructions) && !(parameters.pagesList || []).some(page => machineName(page.library) === 'H5P.DocumentExportPage')) {
      error('The requested written-response export needs a native Document Export page.', 'H5P_AI_INVALID', 422);
    }
    return parameters;
  }
});

/** Strategy objects specialize only their own behavior. Registration happens
 * in trusted application code; an AI response never registers executable code. */
export class StudioAuthoringStrategyRegistry {
  #strategies = new Map();
  #fallback;

  constructor(fallback = semanticsAuthoringStrategy) {
    if (typeof fallback?.id !== 'string' || !fallback.id.trim()) throw new TypeError('The default authoring strategy needs an ID.');
    for (const hook of ['buildContract', 'validateRequest', 'postValidate']) {
      if (typeof fallback?.[hook] !== 'function') throw new TypeError(`The default authoring strategy needs ${hook}.`);
    }
    this.#fallback = this.#compose(fallback);
  }

  #compose(strategy, fallback = null) {
    const result = { id: strategy.id, guidance: strategy.guidance ?? fallback?.guidance };
    for (const hook of ['buildContract', 'validateRequest', 'postValidate']) {
      // Read prototype methods explicitly and bind their original receiver.
      // Spreading a class instance drops methods and breaks private state.
      result[hook] = strategy[hook] ? strategy[hook].bind(strategy) : fallback[hook].bind(fallback);
    }
    return Object.freeze(result);
  }

  register(name, strategy, { replace = false } = {}) {
    if (typeof name !== 'string' || !/^[A-Za-z][\w.-]{0,100}$/.test(name) || typeof strategy?.id !== 'string' || !strategy.id.trim()) {
      throw new TypeError('Register a machine name and an identified authoring strategy.');
    }
    if (!replace && this.#strategies.has(name)) throw new TypeError(`An authoring strategy is already registered for ${name}.`);
    for (const hook of ['buildContract', 'validateRequest', 'postValidate']) {
      if (strategy[hook] != null && typeof strategy[hook] !== 'function') throw new TypeError(`Authoring strategy ${hook} must be a function.`);
    }
    this.#strategies.set(name, this.#compose(strategy, this.#fallback));
    return this;
  }

  resolve(library) { return this.#strategies.get(machineName(library)) || this.#fallback; }
}

export function createStudioAuthoringStrategyRegistry() {
  return new StudioAuthoringStrategyRegistry().register('H5P.DocumentationTool', documentationAuthoringStrategy);
}

export const studioAuthoringStrategies = createStudioAuthoringStrategyRegistry();
