# Chat Mode Feature — Technical Specification

## 1. Overview

### 1.1 Feature Summary
Add an AI-guided conversational interface (Chat Mode) alongside the existing 4-tab workflow UI. Users toggle between modes via a button in the Header. Chat Mode follows the same workflow (Materials → Learning Objectives → Questions → Export) but with an AI assistant guiding each step through natural language conversation and embedded interactive components.

### 1.2 Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| State sync direction | One-way (Chat → Workflow) | Simpler; chat dispatches Redux actions so workflow reflects changes |
| File upload in chat | Drag-and-drop / paste URL in input area | Natural chat UX, no modal interruption |
| Embedded UI granularity | Hybrid (Option C) | Inline UI for simple choices, modal for complex edits, suggest workflow switch for bulk edits |
| LLM provider for chat | OpenAI only | Mature function calling support required |
| Conversation persistence | MongoDB | Users can resume conversations across sessions |

### 1.3 Constraints
- New files must not exceed 300 lines
- Follow existing codebase patterns (Redux Toolkit, Express Router, Mongoose, Shadcn/ui)
- Reuse existing services and API client where possible
- No changes to existing workflow behavior

---

## 2. Architecture

### 2.1 High-Level Flow

```
User message → Frontend ChatInput
    → POST /api/create/chat/message (SSE stream)
    → Backend ChatOrchestrator
        → OpenAI API (with tool definitions)
        → If tool_call: ChatToolExecutor runs internal service
        → Return tool result to OpenAI for next response
    → Stream assistant response + tool results to frontend
    → Frontend renders message + dispatches Redux actions
    → Workflow UI reflects changes via shared Redux store
```

### 2.2 Design Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| **Strategy** | `ChatToolExecutor` | Each tool maps to a strategy function that calls the appropriate service |
| **Observer** | Redux + PubSub (existing) | Chat actions dispatch Redux actions; workflow observes store changes |
| **Facade** | `ChatOrchestrationService` | Single entry point orchestrating LLM calls, tool execution, and streaming |
| **Adapter** | `useChatActions` hook | Adapts tool call results into Redux dispatch calls |
| **Factory** | `ChatMessageRenderer` | Renders different message types (text, tool result, inline UI, error) |

### 2.3 Sequence Diagram

```
Frontend                    Backend                      OpenAI
   │                           │                           │
   │ POST /chat/message        │                           │
   │ { conversationId, msg }   │                           │
   │──────────────────────────>│                           │
   │                           │ chat.completions.create   │
   │                           │ { messages, tools }       │
   │                           │──────────────────────────>│
   │                           │                           │
   │                           │ tool_call: create_folder  │
   │                           │<──────────────────────────│
   │                           │                           │
   │  SSE: tool_call_start     │ Execute: folderService    │
   │<──────────────────────────│                           │
   │                           │                           │
   │  SSE: tool_call_result    │ Return result to OpenAI   │
   │<──────────────────────────│──────────────────────────>│
   │                           │                           │
   │                           │ Stream text response      │
   │  SSE: text_chunk          │<──────────────────────────│
   │<──────────────────────────│                           │
   │                           │                           │
   │  SSE: message_complete    │                           │
   │<──────────────────────────│                           │
   │                           │                           │
   │ Dispatch Redux action     │                           │
   │ (addQuizLocally, etc.)    │                           │
```

---

## 3. Data Model

### 3.1 Conversation (MongoDB)

```javascript
// Model: Conversation
{
  _id: ObjectId,
  user: ObjectId (ref: User),           // Owner
  title: String,                         // Auto-generated or user-set
  folder: ObjectId (ref: Folder),        // Associated folder (set during chat)
  quiz: ObjectId (ref: Quiz),            // Associated quiz (set during chat)
  messages: [{
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: String,                     // Text content
    toolCalls: [{                        // For assistant messages with tool calls
      id: String,                        // OpenAI tool_call_id
      name: String,                      // Function name
      arguments: Object,                 // Parsed arguments
      result: Object,                    // Execution result
      status: 'pending' | 'success' | 'error'
    }],
    metadata: {                          // For frontend rendering hints
      inlineUI: {                        // Optional: embedded UI component spec
        type: String,                    // 'checkbox-list' | 'button-group' | 'file-upload' | ...
        props: Object,                   // Component-specific props
        userResponse: Object             // User's selection (filled after interaction)
      }
    },
    timestamp: Date
  }],
  context: {                             // Current workflow progress
    step: 'init' | 'folder' | 'materials' | 'objectives' | 'plan' | 'questions' | 'export',
    folderId: String,
    quizId: String,
    materialIds: [String],
    objectiveIds: [String],
    planId: String
  },
  status: 'active' | 'completed' | 'archived',
  createdAt: Date,
  updatedAt: Date
}
```

### 3.2 Redux Chat State

```typescript
// New slice: chatSlice.ts
interface ChatState {
  conversations: ConversationSummary[];   // List of past conversations
  activeConversationId: string | null;
  messages: ChatMessage[];                // Messages for active conversation
  isStreaming: boolean;                   // Currently receiving SSE response
  streamingMessage: string;              // Accumulated text during streaming
  pendingToolCalls: ToolCallInfo[];      // Tool calls awaiting results
  context: ConversationContext;          // Current step, folderId, quizId, etc.
  loading: boolean;
  error: string | null;
}
```

---

## 4. Backend API Design

### 4.1 Endpoints

```
POST   /api/create/chat/conversations              Create new conversation
GET    /api/create/chat/conversations              List user's conversations
GET    /api/create/chat/conversations/:id          Get conversation with messages
DELETE /api/create/chat/conversations/:id          Delete conversation

POST   /api/create/chat/conversations/:id/messages  Send message (SSE response)
```

### 4.2 SSE Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `text_chunk` | `{ content: string }` | Streaming text fragment |
| `tool_call_start` | `{ toolCallId, name, arguments }` | LLM is calling a tool |
| `tool_call_result` | `{ toolCallId, name, result, status }` | Tool execution completed |
| `inline_ui` | `{ type, props }` | Render embedded UI component |
| `context_update` | `{ step, folderId?, quizId?, ... }` | Workflow context changed |
| `message_complete` | `{ messageId }` | Assistant message finished |
| `error` | `{ code, message }` | Error occurred |

### 4.3 Request/Response Examples

**Send Message:**
```
POST /api/create/chat/conversations/:id/messages
Content-Type: application/json

{
  "content": "I want to create a quiz about machine learning",
  "inlineUIResponse": {                    // Optional: user's response to inline UI
    "messageId": "msg_abc",
    "selection": { "selectedIds": ["lo_1", "lo_3"] }
  }
}

Response: SSE stream (see event types above)
```

---

## 5. Function Calling (Tool Definitions)

### 5.1 Tool Schema

All tools follow OpenAI's function calling format. The system prompt instructs the LLM about the workflow steps and when to use each tool.

```javascript
// 10 tools organized by workflow step
const CHAT_TOOLS = [
  // Step 1: Setup
  { name: 'create_folder',       description: 'Create a new course folder' },
  { name: 'list_folders',        description: 'List user\'s existing folders' },
  { name: 'create_quiz',         description: 'Create a new quiz in a folder' },

  // Step 2: Materials
  { name: 'add_material_url',    description: 'Add learning material from a URL' },
  { name: 'list_materials',      description: 'List materials in a folder' },
  { name: 'assign_materials',    description: 'Assign materials to a quiz' },

  // Step 3: Learning Objectives
  { name: 'generate_objectives', description: 'Generate learning objectives from materials' },
  { name: 'save_objectives',     description: 'Save selected learning objectives' },

  // Step 4: Questions
  { name: 'generate_plan',       description: 'Generate a question distribution plan' },
  { name: 'generate_questions',  description: 'Generate questions based on plan (streaming)' },

  // Step 5: Export
  { name: 'export_h5p',          description: 'Export quiz as H5P package' },
];
```

See [Section 9: Tool Definitions Detail](#9-tool-definitions-detail) for full parameter schemas.

### 5.2 System Prompt

```
You are a quiz creation assistant for TLEF-CREATE. Guide users through creating
educational quizzes step by step:

1. SETUP: Help create or select a folder and quiz
2. MATERIALS: Help upload/select learning materials
3. OBJECTIVES: Generate and refine learning objectives
4. QUESTIONS: Generate questions from objectives
5. EXPORT: Export the quiz as H5P

Rules:
- Always confirm before executing actions that create or modify data
- When presenting choices (objectives, question types), use the inline_ui
  metadata to render interactive components in the chat
- For file uploads, instruct the user to drag files into the chat or paste URLs
- If the user wants to make detailed edits to multiple questions, suggest
  switching to the Review tab in workflow mode
- Keep responses concise and educational
- Track progress in the context object
```

---

## 6. Frontend Component Architecture

### 6.1 Component Tree

```
Header.tsx (modified — add toggle button)
│
├── [Workflow Mode] QuizView.tsx (existing, unchanged)
│
└── [Chat Mode] ChatMode.tsx
    ├── ChatSidebar.tsx                    // Conversation history list
    ├── ChatMessageList.tsx                // Scrollable message area
    │   └── ChatMessage.tsx (×N)           // Individual message
    │       ├── ChatToolResult.tsx          // Tool call result display
    │       └── ChatInlineAction.tsx        // Embedded UI (checkboxes, buttons)
    └── ChatInput.tsx                      // Text input + file drop zone
```

### 6.2 New Files

| File | Lines (est.) | Responsibility |
|------|:---:|---|
| **Components** | | |
| `src/components/chat/ChatMode.tsx` | ~180 | Main chat container, layout, conversation management |
| `src/components/chat/ChatSidebar.tsx` | ~120 | Conversation history list, new/delete conversation |
| `src/components/chat/ChatMessageList.tsx` | ~100 | Auto-scrolling message list, loading states |
| `src/components/chat/ChatMessage.tsx` | ~150 | Single message bubble, renders text + tool results + inline UI |
| `src/components/chat/ChatToolResult.tsx` | ~200 | Renders tool call results as cards (folder created, LOs generated, etc.) |
| `src/components/chat/ChatInlineAction.tsx` | ~200 | Interactive components: checkbox lists, button groups, confirm buttons |
| `src/components/chat/ChatInput.tsx` | ~200 | Text input, file drop zone, URL paste detection, send button |
| **Hooks** | | |
| `src/hooks/useChatStream.ts` | ~180 | SSE connection for chat responses, event parsing, reconnection |
| `src/hooks/useChatActions.ts` | ~150 | Maps tool call results to Redux dispatches for workflow sync |
| **Redux** | | |
| `src/store/slices/chatSlice.ts` | ~250 | Chat state, async thunks for conversations, message management |
| **Services** | | |
| `src/services/chatApi.ts` | ~80 | Chat-specific API calls (extends api.ts pattern) |
| **Types** | | |
| `src/types/chat.ts` | ~100 | TypeScript interfaces for chat messages, tools, inline UI |
| **Styles** | | |
| `src/styles/components/chat/ChatMode.css` | ~150 | Chat layout, message bubbles, animations |

### 6.3 Modified Files

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add mode toggle button (Chat/Workflow) |
| `src/store/index.ts` | Add `chat: chatReducer` to store |
| `src/App.tsx` | Add mode state, conditional rendering of ChatMode vs QuizView |
| `src/services/api.ts` | Add `chatApi` section (~30 lines) OR use separate `chatApi.ts` |

---

## 7. Backend File Architecture

### 7.1 New Files

| File | Lines (est.) | Responsibility |
|------|:---:|---|
| **Controller** | | |
| `routes/create/controllers/chatController.js` | ~200 | Express router: CRUD conversations, SSE message endpoint |
| **Services** | | |
| `routes/create/services/chatOrchestrationService.js` | ~280 | LLM conversation loop: send messages, handle tool calls, stream response |
| `routes/create/services/chatToolDefinitions.js` | ~200 | OpenAI tool schemas (all 11 tools with parameter definitions) |
| `routes/create/services/chatToolExecutor.js` | ~250 | Strategy pattern: maps tool names to service calls, executes, returns results |
| **Model** | | |
| `routes/create/models/Conversation.js` | ~120 | Mongoose schema for conversation persistence |
| **Config** | | |
| `routes/create/config/chatSystemPrompt.js` | ~80 | System prompt template with workflow instructions |

### 7.2 Modified Files

| File | Change |
|------|--------|
| `routes/create/createRoutes.js` | Mount `chatController` at `/chat` (~3 lines) |

---

## 8. State Synchronization (Chat → Workflow)

### 8.1 Sync Strategy

When the chat backend executes a tool (e.g., `create_folder`), the SSE `tool_call_result` event contains the created resource data. The frontend `useChatActions` hook intercepts these results and dispatches the corresponding Redux actions:

```typescript
// useChatActions.ts — mapping table
const TOOL_DISPATCH_MAP: Record<string, (result: any, dispatch: AppDispatch) => void> = {
  create_folder:       (r, d) => d(addQuizLocally(r.folder)),      // or navigate
  create_quiz:         (r, d) => d(addQuizLocally(r.quiz)),
  add_material_url:    (r, d) => d(addMaterialLocally(r.material)),
  assign_materials:    (r, d) => d(assignMaterials.fulfilled(r)),
  generate_objectives: (r, d) => d(setObjectivesFromChat(r.objectives)),
  save_objectives:     (r, d) => d(saveObjectives.fulfilled(r)),
  generate_plan:       (r, d) => d(setCurrentPlan(r.plan)),
  generate_questions:  (r, d) => d(setQuestionsForQuiz(r)),
  export_h5p:          (r, d) => { /* trigger download */ },
};
```

### 8.2 Context Tracking

The backend tracks workflow progress in `conversation.context`:

```javascript
// After each tool call, update context
context: {
  step: 'objectives',         // Current workflow stage
  folderId: '507f1f77...',    // Created/selected folder
  quizId: '507f1f77...',      // Created/selected quiz
  materialIds: ['...'],       // Uploaded/selected materials
  objectiveIds: ['...'],      // Generated/saved objectives
  planId: '507f1f77...'       // Generated plan
}
```

This context is injected into each LLM call so the AI knows what's been done and what comes next.

### 8.3 Navigation Sync

When user switches from Chat Mode back to Workflow Mode:
1. Read `chatSlice.context` (folderId, quizId)
2. Navigate to `/course/:folderId/quiz/:quizId`
3. Redux store already has the data from chat actions
4. Workflow tabs reflect all work done in chat

---

## 9. Tool Definitions Detail

### 9.1 Setup Tools

```javascript
{
  name: 'create_folder',
  description: 'Create a new course folder for organizing quizzes',
  parameters: {
    type: 'object',
    properties: {
      name:        { type: 'string', description: 'Folder name (e.g. course name)' },
      description: { type: 'string', description: 'Optional folder description' }
    },
    required: ['name']
  }
}

{
  name: 'list_folders',
  description: 'List all folders owned by the current user',
  parameters: { type: 'object', properties: {} }
}

{
  name: 'create_quiz',
  description: 'Create a new quiz within a folder',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Folder ID to create quiz in' },
      title:    { type: 'string', description: 'Quiz title' }
    },
    required: ['folderId', 'title']
  }
}
```

### 9.2 Material Tools

```javascript
{
  name: 'add_material_url',
  description: 'Add learning material from a URL. The system will fetch and process the content.',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Folder to add material to' },
      url:      { type: 'string', description: 'URL of the learning material' },
      title:    { type: 'string', description: 'Optional title for the material' }
    },
    required: ['folderId', 'url']
  }
}

{
  name: 'list_materials',
  description: 'List all materials in a folder',
  parameters: {
    type: 'object',
    properties: {
      folderId: { type: 'string', description: 'Folder ID' }
    },
    required: ['folderId']
  }
}

{
  name: 'assign_materials',
  description: 'Assign selected materials to a quiz for question generation',
  parameters: {
    type: 'object',
    properties: {
      quizId:      { type: 'string', description: 'Quiz ID' },
      materialIds: { type: 'array', items: { type: 'string' }, description: 'Material IDs to assign' }
    },
    required: ['quizId', 'materialIds']
  }
}
```

### 9.3 Objective Tools

```javascript
{
  name: 'generate_objectives',
  description: 'Generate learning objectives from assigned materials using AI. Returns a list for user to review and select.',
  parameters: {
    type: 'object',
    properties: {
      quizId:   { type: 'string', description: 'Quiz ID with assigned materials' },
      count:    { type: 'number', description: 'Number of objectives to generate (default 5)' },
      approach: { type: 'string', enum: ['support', 'challenge', 'balanced'], description: 'Pedagogical approach' }
    },
    required: ['quizId']
  }
}

{
  name: 'save_objectives',
  description: 'Save the selected learning objectives for question generation',
  parameters: {
    type: 'object',
    properties: {
      quizId:       { type: 'string', description: 'Quiz ID' },
      objectiveIds: { type: 'array', items: { type: 'string' }, description: 'Selected objective IDs to keep' }
    },
    required: ['quizId', 'objectiveIds']
  }
}
```

### 9.4 Question Tools

```javascript
{
  name: 'generate_plan',
  description: 'Generate a question distribution plan specifying question types and counts per objective',
  parameters: {
    type: 'object',
    properties: {
      quizId:         { type: 'string', description: 'Quiz ID' },
      totalQuestions:  { type: 'number', description: 'Total questions to generate (default 10)' },
      questionTypes:  { type: 'array', items: { type: 'string', enum: ['mc', 'tf', 'matching', 'ordering', 'cloze', 'sa', 'essay', 'flashcard'] }, description: 'Preferred question types' }
    },
    required: ['quizId']
  }
}

{
  name: 'generate_questions',
  description: 'Generate questions based on the approved plan. This is a long-running operation that streams progress.',
  parameters: {
    type: 'object',
    properties: {
      quizId: { type: 'string', description: 'Quiz ID' },
      planId: { type: 'string', description: 'Approved plan ID' }
    },
    required: ['quizId', 'planId']
  }
}
```

### 9.5 Export Tools

```javascript
{
  name: 'export_h5p',
  description: 'Export the quiz as an H5P interactive content package for download',
  parameters: {
    type: 'object',
    properties: {
      quizId: { type: 'string', description: 'Quiz ID to export' },
      format: { type: 'string', enum: ['h5p', 'pdf'], description: 'Export format (default h5p)' }
    },
    required: ['quizId']
  }
}
```

---

## 10. Inline UI Components

### 10.1 Component Types

The `ChatInlineAction` component renders different UI types based on `metadata.inlineUI.type`:

| Type | When Used | Rendered As |
|------|-----------|-------------|
| `checkbox-list` | Select LOs, select materials, select question types | Checkboxes with labels + Confirm button |
| `button-group` | Quick choices (yes/no, number of questions, approach) | Row of buttons |
| `file-upload` | Material upload step | Drop zone + URL paste field |
| `question-preview` | After question generation | Collapsed question cards with expand |
| `plan-summary` | After plan generation | Table showing type × objective distribution |
| `confirm` | Before executing destructive/important actions | Confirm / Cancel buttons |

### 10.2 Inline UI Flow

1. Backend LLM decides to present choices → includes `inline_ui` in SSE metadata
2. Frontend `ChatMessage` renders `ChatInlineAction` with the spec
3. User interacts (checks boxes, clicks button)
4. User's selection is sent in the next `POST /chat/conversations/:id/messages` as `inlineUIResponse`
5. Backend receives selection, may execute tool call, continues conversation

### 10.3 Modal Escalation

When the AI determines the operation is too complex for inline UI (e.g., editing question content), it sends a `inline_ui` with type `modal-trigger`:

```json
{
  "type": "modal-trigger",
  "props": {
    "label": "Edit Questions in Detail",
    "modalComponent": "QuestionEditModal",
    "data": { "quizId": "...", "questionIds": ["..."] }
  }
}
```

The frontend renders a button that, when clicked, opens the appropriate modal (reusing existing modal components).

### 10.4 Workflow Switch Suggestion

For bulk editing, the AI suggests switching:

```json
{
  "type": "workflow-switch",
  "props": {
    "label": "Switch to Review Tab",
    "targetTab": "review",
    "folderId": "...",
    "quizId": "..."
  }
}
```

Frontend renders a styled button that navigates to the workflow view at the correct tab.

---

## 11. File Upload in Chat

### 11.1 User Experience

The `ChatInput` component supports:

1. **Drag & Drop**: User drags files onto the chat input area
   - Shows a visual drop zone overlay
   - Accepts: PDF, DOCX, TXT, PPTX
   - File is uploaded immediately via existing `materialsApi.uploadFile()`

2. **URL Paste**: User pastes a URL in the text input
   - Auto-detected via regex pattern
   - Shown as a chip/pill above the input
   - Sent as part of the message; backend calls `add_material_url` tool

3. **Text Paste**: Long text is treated as text material
   - If message exceeds a threshold (e.g., 500 chars), offer to save as text material

### 11.2 Upload Flow

```
User drops file → ChatInput shows file preview chip
User sends message → Frontend uploads file via materialsApi.uploadFile()
                   → After upload success, sends chat message with materialId reference
                   → Backend LLM acknowledges upload, continues workflow
                   → useChatActions dispatches addMaterialLocally()
```

---

## 12. Error Handling

### 12.1 LLM Errors
- Timeout: After 60s with no response, show retry button in chat
- Rate limit: Show "Please wait" with cooldown timer
- Invalid tool call: Backend catches, returns error result to LLM, LLM self-corrects

### 12.2 Tool Execution Errors
- Backend wraps each tool execution in try/catch
- Error result returned to LLM as tool result with `status: 'error'`
- LLM acknowledges the error and suggests alternatives
- Frontend shows error as a distinct message style (red border)

### 12.3 SSE Connection Errors
- Reuse `useSSE` reconnection pattern (exponential backoff, max 5 attempts)
- On permanent failure, show "Connection lost" with manual reconnect button
- Messages already received are preserved in Redux state

---

## 13. Implementation Phases

### Phase 1: Foundation (Core Chat Loop)
**Goal**: User can chat with AI, AI can call tools, basic text conversation works.

**Backend:**
- [ ] `Conversation` model
- [ ] `chatController.js` — CRUD + SSE message endpoint
- [ ] `chatOrchestrationService.js` — OpenAI integration with tool calling loop
- [ ] `chatToolDefinitions.js` — All tool schemas
- [ ] `chatToolExecutor.js` — Execute `create_folder`, `list_folders`, `create_quiz` only
- [ ] `chatSystemPrompt.js` — System prompt
- [ ] Mount in `createRoutes.js`

**Frontend:**
- [ ] `chat.ts` types
- [ ] `chatSlice.ts` — State management
- [ ] `chatApi.ts` — API calls
- [ ] `useChatStream.ts` — SSE hook
- [ ] `ChatMode.tsx` — Main container
- [ ] `ChatMessageList.tsx` + `ChatMessage.tsx` — Message rendering
- [ ] `ChatInput.tsx` — Text input (no file upload yet)
- [ ] `ChatToolResult.tsx` — Basic tool result cards
- [ ] Toggle button in `Header.tsx`
- [ ] Wire up in `App.tsx`

**Sync:**
- [ ] `useChatActions.ts` — Dispatch for create_folder, create_quiz

### Phase 2: Full Workflow (Materials + Objectives + Questions)
**Goal**: Complete workflow through chat with inline UI and state sync.

**Backend:**
- [ ] Implement remaining tools in `chatToolExecutor.js`: materials, objectives, plan, questions
- [ ] Handle `generate_questions` streaming within chat SSE (nested streaming)
- [ ] Inline UI metadata generation in orchestration service

**Frontend:**
- [ ] `ChatInlineAction.tsx` — Checkbox lists, button groups, confirm
- [ ] `ChatInput.tsx` — Add file drag & drop, URL paste detection
- [ ] `useChatActions.ts` — All remaining Redux sync mappings
- [ ] `ChatSidebar.tsx` — Conversation history
- [ ] Chat → Workflow navigation sync (switch back shows correct state)

### Phase 3: Polish & Export
**Goal**: Export support, modal escalation, edge cases.

**Backend:**
- [ ] Implement export tools in executor
- [ ] Conversation title auto-generation (LLM summarize)
- [ ] Conversation archiving / cleanup

**Frontend:**
- [ ] Modal escalation (question editing modal triggered from chat)
- [ ] Workflow switch suggestion button
- [ ] `ChatMode.css` — Animations, responsive design
- [ ] Question preview inline component
- [ ] Plan summary inline component
- [ ] Error states and retry UI
- [ ] Loading skeletons during streaming
- [ ] Mobile responsive chat layout

---

## 14. Testing Strategy

### 14.1 Backend Tests

| Test File | Type | Coverage |
|-----------|------|----------|
| `__tests__/unit/chatToolExecutor.test.js` | Unit | Tool execution strategies, error handling |
| `__tests__/unit/chatToolDefinitions.test.js` | Unit | Schema validation |
| `__tests__/integration/chat.test.js` | Integration | Full conversation flow, SSE events, persistence |

### 14.2 Frontend Tests

| Test File | Type | Coverage |
|-----------|------|----------|
| `src/components/chat/__tests__/ChatMessage.test.tsx` | Component | Renders text, tool results, inline UI |
| `src/components/chat/__tests__/ChatInput.test.tsx` | Component | Send message, file drop, URL detection |
| `src/components/chat/__tests__/ChatInlineAction.test.tsx` | Component | User interactions, selection callbacks |
| `src/hooks/__tests__/useChatStream.test.ts` | Hook | SSE parsing, reconnection, event mapping |
| `src/hooks/__tests__/useChatActions.test.ts` | Hook | Redux dispatch mapping correctness |

---

## 15. Security Considerations

- **Authentication**: Chat endpoints use existing `authenticateToken` middleware
- **Authorization**: Conversations are scoped to `user` field; all tool executions verify resource ownership
- **Input Sanitization**: User messages sanitized before LLM prompt injection
  - Strip system-prompt-like patterns
  - Limit message length (e.g., 4000 chars)
- **Rate Limiting**: Chat message endpoint rate-limited (e.g., 20 messages/minute)
- **Tool Execution**: All tools execute through existing service layer which already validates permissions
- **File Upload**: Reuses existing Multer validation (file type, size limits)

---

## 16. Performance Considerations

- **Conversation History Truncation**: Only send last N messages (e.g., 20) + system prompt to LLM to stay within token limits. Older messages summarized.
- **SSE Keep-Alive**: Heartbeat every 15s to prevent proxy timeouts
- **Lazy Loading**: Chat components code-split with `React.lazy()` — only loaded when Chat Mode activated
- **Message Pagination**: Load older messages on scroll-up (not all at once)
- **Debounced Input**: URL detection regex runs on debounced input (300ms)

---

## Appendix A: File Inventory

### New Files (17 files)

```
# Frontend (13 files)
src/types/chat.ts                              ~100 lines
src/store/slices/chatSlice.ts                  ~250 lines
src/services/chatApi.ts                        ~80 lines
src/hooks/useChatStream.ts                     ~180 lines
src/hooks/useChatActions.ts                    ~150 lines
src/components/chat/ChatMode.tsx               ~180 lines
src/components/chat/ChatSidebar.tsx             ~120 lines
src/components/chat/ChatMessageList.tsx         ~100 lines
src/components/chat/ChatMessage.tsx             ~150 lines
src/components/chat/ChatToolResult.tsx          ~200 lines
src/components/chat/ChatInlineAction.tsx        ~200 lines
src/components/chat/ChatInput.tsx               ~200 lines
src/styles/components/chat/ChatMode.css         ~150 lines

# Backend (6 files)
routes/create/models/Conversation.js            ~120 lines
routes/create/controllers/chatController.js     ~200 lines
routes/create/services/chatOrchestrationService.js  ~280 lines
routes/create/services/chatToolDefinitions.js   ~200 lines
routes/create/services/chatToolExecutor.js      ~250 lines
routes/create/config/chatSystemPrompt.js        ~80 lines
```

### Modified Files (4 files)

```
src/components/Header.tsx                      +20 lines (toggle button)
src/store/index.ts                             +3 lines (add chat reducer)
src/App.tsx                                    +15 lines (mode routing)
routes/create/createRoutes.js                  +3 lines (mount chat controller)
```

**Total estimated new code**: ~2,990 lines across 17 new files (avg ~176 lines/file)
**Max file size**: 280 lines (chatOrchestrationService.js)
