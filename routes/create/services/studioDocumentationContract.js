const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = { type: 'string' };
const nested = (library, params) => object({
  library: { type: 'string', enum: [library] },
  params,
  metadata: object({ title: text })
});

// A bounded authoring contract for new text-based documentation activities.
// Native translation defaults remain owned by installed H5P semantics, not AI.
export const documentationOutputSchema = {
  name: 'documentation_activity',
  schema: object({
    title: text,
    params: object({
      taskDescription: text,
      pagesList: { type: 'array', minItems: 1, maxItems: 5, items: { anyOf: [
        nested('H5P.StandardPage 1.5', object({ elementList: {
          type: 'array', minItems: 1, maxItems: 8, items: { anyOf: [
            nested('H5P.Text 1.1', object({ text })),
            nested('H5P.TextInputField 1.2', object({ taskDescription: text, placeholderText: text,
              inputFieldSize: { type: 'string', enum: ['3', '10'] } }))
          ] }
        } })),
        nested('H5P.GoalsPage 1.5', object({ description: text })),
        nested('H5P.GoalsAssessmentPage 1.4', object({ description: text })),
        nested('H5P.DocumentExportPage 1.5', object({ description: text }))
      ] } }
    })
  })
};

export const documentationAuthoringGuidance = [
  'Documentation Tool is a sequence of native pages. Its content is params.pagesList (required, never omit it).',
  'For reading/reflection use H5P.StandardPage 1.5 with params.elementList. Put reading content in H5P.Text 1.1 params.text and learner responses in H5P.TextInputField 1.2 params.taskDescription.',
  'Give every page and element a meaningful metadata.title. When response export is requested, include a final H5P.DocumentExportPage 1.5. Use GoalsPage and GoalsAssessmentPage only when relevant to the teaching request.',
  'Documentation Tool does not support scored multiple-choice pages. Do not invent or silently convert a requested multiple-choice step; CREATE rejects that incompatible brief before this prompt.',
  'Do not output only taskDescription or an empty pagesList. Follow the output schema, leaving translation labels to the official defaults.'
].join('\n');
