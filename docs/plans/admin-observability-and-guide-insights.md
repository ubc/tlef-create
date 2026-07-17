# Admin Observability and CREATE Guide Insights

## Goals

- Persist CREATE Guide questions, answers, citations, model/fallback status, latency, and instructor ratings.
- Give administrators a privacy-safe operation timeline.
- Let administrators inspect users, courses, quizzes, learning objectives, plans, and generated questions in read-only mode.
- Preserve existing bug-report and API-key permission management.

## Privacy Boundary

Admin read-only views may show:

- User identity and account activity timestamps.
- Course names and aggregate counts.
- Material names, types, sizes, page/chunk counts, and processing status.
- Quiz settings, learning objectives, subpoints, plans, questions, explanations, and review status.
- CREATE Guide conversations and user-submitted quality feedback.

Admin read-only views must not show:

- Raw PDF or DOCX files.
- Full parsed material content or uploaded text.
- Local file paths or private source URLs.
- API keys, passwords, session data, or authentication assertions.
- System, course, or generation prompt text.
- Request bodies in audit events.

## Data Model

### HelpInteraction

Stores one CREATE Guide request lifecycle: `processing`, `completed`, or `failed`. A completed record can receive an owner-only `helpful` or `not-helpful` rating with optional structured reasons and a comment.

### AuditEvent

Stores the actor, action name, resource identifiers, route, HTTP result, and an allowlisted metadata object. Content and credential fields are never copied from request bodies.

## Admin Views

- **Overview:** live platform counts and 30-day active users.
- **Users & Courses:** read-only drill-down from instructor to course to quiz.
- **Activity:** filterable operation timeline.
- **Guide Insights:** conversations, ratings, fallbacks, failures, and common questions.
- **Bug Reports:** existing issue workflow.
- **API Keys:** existing environment-key permission controls.

## Operational Notes

- Historical events begin accumulating after this feature is deployed; prior actions cannot be reconstructed reliably.
- Admin inspection itself is recorded through `admin.view_user_courses`, `admin.view_course`, and `admin.view_quiz` events.
- A formal retention period should be agreed with the project privacy owner before production launch. Until then, no automatic deletion policy is applied.
