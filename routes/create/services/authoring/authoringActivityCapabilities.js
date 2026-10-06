import { listH5PTypeAdapters } from '../../config/h5pTypeAdapterRegistry.js';
import { getStudioCatalog, libraryProblems } from '../h5pStudioCatalog.js';
import { studioAuthoringStrategies } from '../studioAuthoringStrategies.js';

/** One query boundary for both authoring representations. CREATE Question
 * records keep their existing adapter pipeline; native activities keep the
 * installed-semantics pipeline. Installing a library never implies that it has
 * a CREATE Question adapter, material evidence, or a verified answer. */
export function createAuthoringActivityCapabilities({ adapters = listH5PTypeAdapters, catalog = getStudioCatalog,
  strategies = studioAuthoringStrategies } = {}) {
  const nativeRecord = (type, definitions) => ({
    representation: 'native-h5p', library: type.library, machineName: type.machineName, label: type.title,
    category: type.category, version: type.version, mode: type.mode,
    available: type.mode === 'generate' || type.mode === 'template', needsTemplate: type.mode === 'template',
    contractSource: 'installed-h5p-semantics', strategyId: strategies.resolve(type.library).id,
    guidance: type.guidance, authoringGuidance: strategies.resolve(type.library).guidance,
    questionTypes: definitions.filter(adapter => adapter.mainLibrary === type.library && adapter.aiEnabled && adapter.convertible)
      .map(adapter => ({ questionType: adapter.type, label: adapter.label, containers: [...adapter.containers] }))
  });
  const questionRecord = (adapter, container, installed) => {
    const native = installed.types.find(type => type.library === adapter.mainLibrary);
    const library = installed.libraries?.get(adapter.mainLibrary);
    // Embedded libraries are omitted from the top-level native catalog. A
    // canonical course adapter may use them without making them standalone AI
    // activities. An explicit native mode always retains its stricter gate.
    const embedded = !native && (library?.descriptor?.runnable === 0 || library?.descriptor?.runnable === false);
    const problems = embedded ? libraryProblems(adapter.mainLibrary, installed.libraries) : [];
    const compatible = adapter.containers.includes(container);
    const available = adapter.aiEnabled && adapter.convertible && compatible
      && (native?.mode === 'generate' || (embedded && !problems.length));
    const reason = !adapter.aiEnabled || !adapter.convertible ? 'This type has no enabled CREATE question-authoring adapter.'
      : !compatible ? `${adapter.label} is unavailable in the ${container} layout.`
        : !native && !embedded ? 'The required pinned H5P library is not installed.'
          : problems.length ? problems[0] : native && native.mode !== 'generate' ? native.guidance : null;
    return {
      representation: 'course-question', questionType: adapter.type, label: adapter.label, library: adapter.mainLibrary,
      container, containers: [...adapter.containers], available: Boolean(available), needsTemplate: native?.mode === 'template',
      mode: available ? 'generate' : 'unavailable', contractSource: 'create-question-adapter',
      guidance: reason || native?.guidance || 'Use the installed embedded library through its course-question adapter.', reason
    };
  };

  return Object.freeze({
    listQuestionTypes({ container = 'column', catalog: installed = catalog(), includeUnavailable = false } = {}) {
      return adapters().filter(adapter => adapter.aiEnabled).map(adapter => questionRecord(adapter, container, installed))
        .filter(type => includeUnavailable || type.available);
    },
    listNativeActivities({ catalog: installed = catalog(), includeUnavailable = true } = {}) {
      const definitions = adapters();
      return installed.types.map(type => nativeRecord(type, definitions)).filter(type => includeUnavailable || type.available);
    },
    resolve({ questionType, library, container = 'column', catalog: installed = catalog() } = {}) {
      if (Boolean(questionType) === Boolean(library)) throw new TypeError('Resolve either a CREATE question type or a native H5P library.');
      const definitions = adapters();
      if (questionType) {
        const adapter = definitions.find(type => type.type === questionType);
        return adapter ? questionRecord(adapter, container, installed) : null;
      }
      const type = installed.types.find(type => type.library === library);
      return type ? nativeRecord(type, definitions) : null;
    }
  });
}

export const authoringActivityCapabilities = createAuthoringActivityCapabilities();
export const listAuthoringQuestionTypes = options => authoringActivityCapabilities.listQuestionTypes(options);
export const listAuthoringNativeActivities = options => authoringActivityCapabilities.listNativeActivities(options);
export const resolveAuthoringActivity = options => authoringActivityCapabilities.resolve(options);
