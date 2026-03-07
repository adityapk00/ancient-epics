1. Make the admin model match the product language: translations vs ingestion sessions
   Problem: the UI presents a "Translations" screen, but it is really listing ingestion sessions and opening them by session id. That works for the current happy path, but it will break down once one translation needs multiple runs, retries, or revision passes. It also makes the mental model muddy for admins because a translation is a content artifact, while a session is just the workflow used to produce or edit it.
   Solution: separate the domain objects in the UI and API shape. The translations screen should list real translation drafts, with status/progress metadata and the latest linked session if one exists. Session history should become a secondary detail inside a translation workspace, not the primary thing users think they are opening.

2. Make the books landing screen operational, not just navigational
   Problem: the current Books / Stories view is easy to scan, but it does not tell the admin where work is needed. There is no translation count, draft count, last-updated timestamp, or completion indicator, so the landing page shows what exists but not which book needs attention.
   Solution: enrich each book card with workflow metadata pulled from D1, such as number of chapters, number of translation drafts, latest activity, and a progress summary like chapters saved vs total. The home screen should help an operator decide what to open next without guessing.

3. Add a real chapter editor before book creation
   Problem: chapter splitting currently previews the result of a regex/delimiter strategy, but the preview is not editable. In practice, pasted texts will almost always need hand-fixes: rename a chapter, adjust a slug, merge/split one chapter, or remove junk content.
   Solution: turn split preview into an editable staging area. Each chapter draft should allow title edits, slug edits, source text edits, reorder, merge, split, and delete before the book is created. Keep the auto-splitting controls, but treat them as a first pass rather than the last step.

4. Reduce friction when creating a translation draft
   Problem: the translation creation screen asks for name, slug, description, model, prompt, and context window all at once. That makes the first step feel configuration-heavy, even though most users probably just want to start a draft from defaults and tune later.
   Solution: make the default path lightweight. Require only the translation name up front, prefill the rest from saved settings, and tuck advanced options behind an expandable section or move them into the workspace settings panel after creation.

5. Persist and reload full translation metadata when reopening a draft
   Problem: after opening an existing draft, some metadata is effectively lost in the UI flow because the workspace only reliably reloads session fields, not all persisted translation fields. This makes slug/description management feel one-way and undermines trust that the draft is fully editable after creation.
   Solution: when a draft is opened, load the linked translation record and hydrate the workspace with its name, slug, description, prompt, model, and related workflow settings. Add explicit save behavior for translation metadata so reopening a draft feels stable and reversible.

6. Replace raw JSON review with a structured chapter review editor
   Problem: the workspace currently asks the admin to review and edit raw JSON as the primary interface. That is acceptable as a debugging fallback, but not as the main editorial workflow. It forces users to think about serialization details instead of chunk quality, alignment, and translation choices.
   Solution: build a structured chapter editor that exposes chapter title, original chunks, translation chunks, sourceChunkIds, and validation warnings as form controls. Keep a collapsible raw JSON panel for advanced debugging, but make the main experience chunk-first and editor-friendly.

7. Strengthen the AI prompt/response contract with validation and repair
   Problem: the generation pipeline still relies too much on a single raw model response being well-formed. Even with normalization, malformed or partially valid JSON will keep leaking friction into the review step.
   Solution: define a stricter response schema, validate every model response against it, and add an automatic retry/fix loop that asks the model to repair invalid output before it reaches the editor. Surface clear error states when repair fails, including which schema rule was violated.

8. Turn validation into a finish line, not just a report
   Problem: the validation screen is useful, but it stops at diagnosis. The product copy implies a publish/export step after validation, yet the screen currently behaves like a dead end with only a way back to the workspace.
   Solution: extend validation into an action screen. Add per-issue jump links back to the affected chapter, show a clear readiness summary, and introduce explicit next actions such as mark ready, publish draft, export draft JSON, or continue editing.

9. Make validation issues actionable at the chapter level
   Problem: validation shows issues and a side-by-side preview, but it does not help the operator move directly from a specific issue to the precise place that needs fixing.
   Solution: attach issue metadata to chapter cards and provide "open in workspace" actions that navigate straight to the affected chapter. Where possible, point to the exact missing anchor, empty chunk, or malformed section so the editor can fix it without hunting.

10. Persist generated chapter documents into canonical draft records, not just session state
    Problem: ingestion sessions are a useful workflow scaffold, but generated original/translation chapter documents still need to live cleanly in the actual draft book/translation storage model so later publishing, exporting, and re-editing are not dependent on session records alone.
    Solution: save reviewed chapter outputs into the canonical draft translation records and R2 keys as the primary source of truth, while keeping ingestion sessions as audit/history/work-in-progress metadata.

11. Separate secure settings from authoring defaults
    Problem: the settings drawer currently mixes the OpenRouter API key with default model/prompt configuration in one flat panel. That is manageable now, but it will get messy as more controls are added and it obscures the difference between secrets and reusable editorial defaults.
    Solution: split settings into clear sections such as Credentials, Generation Defaults, and possibly Workspace Defaults. Make it obvious which values are global defaults, which are per-draft overrides, and which are sensitive secrets.
