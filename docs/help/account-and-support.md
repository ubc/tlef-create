# Account, AI Settings, and Support

The User Account page contains sign-out, role information, AI provider settings, the Help Center link, and the issue-reporting form.

## Open the Help Center

Select **Help & Support** in Account Settings to open this manual. The page is generated from the Markdown files in `docs/help`, so the standalone manual and CREATE Guide use the same curated knowledge.

Use the table of contents or search field to find a topic. A link opened from a CREATE Guide source card automatically scrolls to and highlights the cited section.

## AI API key settings

General Settings contains the available AI API key controls. A first-use prompt may appear when an account needs a key and cannot use a deployment-provided key. Follow the provider and model options shown in the interface.

Treat API keys as passwords. Do not paste them into course materials, prompts, CREATE Guide, question text, or a bug report. If a key is exposed, revoke it with the provider and replace the saved key.

## Report an issue

Go to **User Account → Report Issues → Report Question Bug**. Choose the closest type, enter a description, optionally provide an email, and submit.

| Report type | Use it for |
| --- | --- |
| Question Bug | Broken behavior, generation failure, export problem, or another software defect |
| Incorrect Answer | A wrong answer key, explanation, or generated factual claim |
| Unclear Question | Ambiguous wording, confusing options, or insufficient context |
| Other Issue | Documentation, account, material, or workflow issues not covered above |

The description is required and accepts up to 2,000 characters. Email is optional. A submitted report begins with **open** status; administrators can move it to **in progress**, **resolved**, or **closed** and add internal notes. There is currently no user-facing report-status page, so include an email if a reply may be needed.

## Write a useful report

Include:

1. The course and learning object, without confidential student information.
2. The page or tab where the issue occurred.
3. The exact action you took and whether it can be repeated.
4. What you expected and what actually happened.
5. The visible error message and affected question type, target, or format.
6. For content problems, the question wording and why the cited evidence does not support it.
7. Browser and approximate time if the behavior appears intermittent.

The form does not currently upload screenshots or log files. Summarize the visible details in the description. Never include passwords, API keys, authentication cookies, private student data, or protected course content that is not necessary to reproduce the issue.

## CREATE Guide feedback versus a bug report

Use the thumbs-up/down control under an AI help answer to rate that answer. Negative feedback can identify incorrect, outdated, unclear, or incomplete help content. Use Report Issues when the product itself is broken, generated course content is wrong, or follow-up may be required. Guide feedback and bug reports are stored and reviewed separately.

## Sign out and session expiry

Sign Out ends the authenticated session. If a session expires while CREATE is open, protected requests stop and the application returns to sign-in. Save edits through their normal action before leaving the application; unsent text in an open form may be lost.
