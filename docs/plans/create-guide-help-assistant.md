# CREATE Guide Help Assistant

## Purpose

CREATE Guide is a global, read-only help assistant for instructors. It explains the current interface, answers product questions, cites maintained help content, and links users to relevant workflow tabs. It does not modify course data.

## Runtime flow

1. `CreateGuide.tsx` captures the question and current route/tab context.
2. `POST /api/create/help/chat` opens an authenticated SSE response.
3. `helpKnowledgeService.js` reloads curated help documents when their content hash changes.
4. The service retrieves the most relevant chunks using query, route, tab, title, keyword, and synonym signals.
5. `helpChatService.js` sends only those chunks and recent bounded conversation history to the configured LLM.
6. The response streams to the widget and ends with source cards and navigation links.
7. If the LLM is unavailable, the highest-ranked retrieved help excerpt is returned as a static fallback.

## Knowledge sources

Teacher-facing guides live in `docs/help/*.md`. Question-type compatibility is generated directly from `src/constants/questionTypeCapabilities.ts`, which prevents a separately maintained compatibility table from becoming stale.

The knowledge service calculates a SHA-256 hash over all help documents and generated capability facts. It rebuilds its in-memory chunks whenever that hash changes. A server restart is not required for help-document edits in development.

## Updating knowledge with a feature

1. Update the canonical product code and capability constants.
2. Update or add the relevant `docs/help/*.md` guide.
3. Include the route, user-visible labels, expected behavior, and failure recovery.
4. Add a retrieval regression test when the feature introduces new terminology.
5. Run the CREATE Guide unit tests and frontend build.

## Security and scope

- Endpoints require the existing authenticated session.
- User messages are length-limited and treated as untrusted queries.
- Only allowlisted product-help documents are retrieved.
- Course materials, API keys, environment files, and source code outside the capability registry are excluded.
- The assistant is explicitly instructed not to expose hidden prompts or chain-of-thought.
- Conversation history is bounded and stored only in browser session storage in this phase.

## Future semantic index

The current retrieval layer is deliberately local and resilient, so CREATE Guide works even when Qdrant is unavailable. If the help corpus grows substantially, the same chunks can be mirrored into a dedicated `product-help` Qdrant collection. The local retriever should remain as fallback, and product-help vectors must never share the course-material collection.

