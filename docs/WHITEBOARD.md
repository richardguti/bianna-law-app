# Whiteboard

A canvas for sketching doctrine, plus a one-click conversion of that sketch into a four-tier outline.

## Files

Saving a sketch writes **three** files, all named from the same stem (`<timestamp> - <title>`):

| File | What it is |
|---|---|
| `<stem>.excalidraw` | The scene: `{ elements, appState }`. This is the source of truth. |
| `<stem>.png` | A 2x render, used as the preview in the sketch list. 1x looks blurry on Retina. |
| `<stem>.md` | The text-tool labels, so the sketch is searchable through the ICM index. |

The `.excalidraw` file is written via a temp file plus rename, so a crash mid-write cannot leave a
half-written canvas where a readable one used to be.

`appState` is **not** persisted wholesale. Only `viewBackgroundColor` and `gridSize` are kept —
the rest is transient editor state (open dialogs, scroll position, collaboration flags) that must
not become part of the file.

## Where files live

`<OS Documents folder>/Bianna_Law/Whiteboards` — the same expression on both platforms, because
`getBiannaLawDir()` in `jsons/main.js` is `app.getPath('documents') + 'Bianna_Law'`:

| Platform | Path |
|---|---|
| Windows | `%USERPROFILE%\Documents\Bianna_Law\Whiteboards` |
| macOS | `~/Documents/Bianna_Law/Whiteboards` |

**On Windows this is usually the OneDrive path, not `%USERPROFILE%\Documents`.** The OS Documents
folder is frequently redirected, so the real location on this machine is:

```
C:\Users\ibeli\OneDrive\Documents\Bianna_Law\Whiteboards
```

Do not hard-code either form — ask `app.getPath('documents')`. This is not hypothetical: an
acceptance check that looked for files under `%USERPROFILE%\Documents` reported the whiteboard
feature as broken when it was working, because the folder had been redirected to OneDrive. The
same redirection is visible in `boot.log` for the corpus:

```
corpus install done: dest=C:\Users\ibeli\OneDrive\Documents\Bianna_Law\references\florida-statutes
```

The **main process** owns this path (`whiteboardDir()` in `jsons/main.js`) and reports it back over
IPC; the renderer only displays what it is told. Two places deciding where a file lives is how the
write and read paths drift apart.

The directory is created on demand (`fs.mkdirSync(dir, { recursive: true })`), so it appears the
first time a sketch is saved or an outline is converted — not at install time. A missing folder
before first use is correct, not a defect.

`SLP_WHITEBOARD_DIR` overrides everything else and is checked **first**, which is what the test
harnesses set so test sketches never land in the real Documents folder.

## Convert to outline

Text-tool labels are extracted **exactly** — they are JSON strings from the scene, so there is nothing
to interpret. They go to a review modal first, because that modal is the last place a wrong reading
can be caught.

**There is no OCR, deliberately.** Handwriting recognition runs 40–60% on cursive, which for legal
terms means most of what it read would be wrong, and a review step that is really a retyping step
helps nobody. Freehand strokes are saved with the sketch (in the `.excalidraw` and the `.png`) but
are **not** read. Anything that should become outline content must come from the text tool.

Below **40 characters** no model call is made at all — the UI says
*"Not enough text extracted. Add more using the text tool."* A fragment cannot become an outline.

The conversion prompt carries an explicit no-invention gate: *"Do not add doctrinal content not
present in the source. If the source is too fragmentary, list what is present and stop."*

The resulting outline is written to `~/Documents/Bianna_Law/Whiteboards/<title> - Outline <stamp>.docx`.

## Canvas

The canvas is Excalidraw (`@excalidraw/excalidraw`), mounted in
`src/pages/Whiteboard.tsx`. The toolbar sits bottom-left: freehand pen, arrows, text, shapes,
highlighter, eraser. Apple Pencil and trackpad both work.

Nothing about the persisted shape changed to adopt it. A label element and an Excalidraw text
element are the same object — `{ id, type: 'text', text }` inside `{ elements, appState }` — so
every sketch the earlier label editor saved reopens on the canvas with no migration.

Three integration rules that are easy to get wrong:

- **`initialData` is read once, at mount.** The canvas is keyed by `mountKey`, which changes only
  when a different sketch is opened. Passing the scene on every render would re-initialize the
  canvas mid-stroke.
- **Do not use Excalidraw's own persistence.** `loadScene`, `export`, and `saveToActiveFile` are
  disabled in `UIOptions`; the app owns saving through `jsons/whiteboard/index.js`.
- **`onChange` fires many times per second.** The save is debounced 5 s and the debounce wraps the
  *write*, not a state update. Nothing is written synchronously from `onChange`.

Elements are persisted **verbatim**. Do not add a field whitelist or a `.map()` on either side:
Excalidraw needs `version`, `versionNonce`, `seed`, `strokeStyle`, `roundness`, `boundElements`
and the rest, and a filtered element loads as a blank canvas.

Theme follows the app. The app applies its theme as a `data-theme` attribute on `<html>` (see
`applyTheme()` in `src/lib/theme.ts`), which is **not** a `.dark` class and is not in the app
store — so the canvas reads `dataset.theme`, and watches it so an OS appearance change does not
leave the canvas behind.

## Text extraction

Only elements with `type === 'text'` become outline source. Arrows, shapes, and freehand strokes
are visual — they are saved with the sketch and appear in the `.png`, but they are **not read**.
There is no OCR, by decision: handwriting recognition runs 40–60% on cursive, so a review step
built on it would really be a retyping step.

The same filter lives in two places and they are kept identical by construction:
`extractText()` in `jsons/whiteboard/index.js` and `textFromScene()` in
`src/lib/whiteboard/store.ts`.

## Images

**Not supported.** Excalidraw's `onChange` passes a third argument, a `files` map, carrying images
pasted into the canvas. It is deliberately ignored, so a pasted image does not survive a save.
Supporting images would need its own persistence layer (base64 into the `.excalidraw` works for
small images, at the cost of file size).

## Fallback

If the canvas fails to mount or throws, `CanvasErrorBoundary` catches it and renders the original
label editor with a banner: *"Canvas unavailable - using label editor."* The label editor was kept
rather than deleted for exactly this reason.

It writes the same scene shape the canvas does — appending `{ id, type: 'text', text }` elements —
so a sketch begun in the fallback opens on the canvas, and vice versa. A failed canvas therefore
degrades to a working editor instead of a blank page.

## Build note: mermaid is stubbed

Excalidraw reaches mermaid only through a lazy `import("@excalidraw/mermaid-to-excalidraw")` inside
its Mermaid dialog, which this app does not expose. Resolving that import at build time pulled in
the whole mermaid subtree and aborted the Vite 8 / rolldown build with
`[Panic in async function] code: 'GenericFailure'`, reproducibly and even with an 8 GB heap.

`jsons/vite.config.ts` therefore aliases that specifier to `jsons/stubs/excalidraw-mermaid-stub.js`.
Un-siloing it means removing the alias and confirming the build, because the panic is a bundler
problem, not a code problem.


- **Freehand strokes are not read.** Only text-tool labels become outline content.
- **No OCR**, by decision — see above.
- **The PNG is not written when there is no canvas renderer**, which is the case while the label
  editor is in use. The `.excalidraw` and `.md` are always written.

## Dependencies

`@excalidraw/excalidraw` is installed. The scene format is the same either way — every label is a
`{ id, type: 'text', text }` element inside `{ elements, appState }` — so a saved sketch does not need
migrating if the render layer changes.

**Re-check on major upgrades.** Excalidraw's element shape carries fields the renderer depends on
(including `versionNonce`), and a partial element fails to load. Persist elements **as-is**; do not
strip fields on the way in or out.

Two integration notes for when the canvas is mounted:

- Do not use Excalidraw's own persistence. Disable `loadScene`, `export`, and `saveToActiveFile` in
  `UIOptions` — the app owns saving through `jsons/whiteboard/index.js`.
- `onChange` fires on every interaction. Debounce it; never save synchronously from it.
