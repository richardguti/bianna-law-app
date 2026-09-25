# YouTube outline generator: what was actually wrong

The proposal was to replace `youtube-transcript` with `youtube-transcript-nodejs`, on the theory
that YouTube now requires a PoToken bound to the video ID and the old library therefore returns
an empty transcript for every video. I tested that before changing anything. **The theory is
false on this machine, and the library swap was not made.**

## The measurement

`youtube-transcript@1.3.0` is already installed. Loaded exactly the way `main.js` loads it (the
ESM/CJS interop shim in `loadYoutubeTranscript`), against the video named in the plan:

```
7pmW6lwi-m0   Graham v. Connor
  41 segments, 1451 chars, 299ms
  HEAD: "When a diabetic has an insulin reaction, his body systems start shutting down and he
         collapses into shock. But consider Dethorne Graham..."

jNQXAC9IVRw   Me at the zoo
  6 segments, 217 chars, 134ms
```

No empty body. No PoToken refusal. Nothing to bypass. The captions path works.

## Why the diagnosis was plausible but wrong

Two things made it convincing, and both are worth recording because they will mislead again:

**1. The error message pointed at the wrong stage.** The plan quotes *"Outline generation failed
for every video"* and reads it as a captions failure. That string lives at `main.js:3136`, inside
`if (perVideo.length === 0)` — it fires when the **LLM** stage produced nothing. A captions failure
takes a different branch entirely, `main.js:3110`, and says *"No transcripts available. Captions
may be disabled on all videos."* Quoting the first while diagnosing the second is the whole error.

**2. The actual cause was upstream and already known.** Reproducing the pipeline stage by stage
with the app's own inputs:

```
STAGE 1 — captions        41 segments, 1451 chars   -> SUCCEEDED
STAGE 2 — DeepSeek outline  HTTP 401 after 460ms    -> FAILED
   {"error":{"message":"Authentication Fails, Your api key: ****c7f3 is invalid",
             "type":"authentication_error"}}
```

`getDeepSeekKey()` resolves `store.get('deepseekApiKey') || store.get('anthropicApiKey') ||
DEFAULT_DEEPSEEK_KEY`, and the shipped default key is dead — verified by reading it out of the
shipped `app.asar` and calling the API with it. Every `callDeepSeekMain` in that loop fails, so
`perVideo` stays empty, so the generic message is shown. **The YouTube outline generator was never
broken by YouTube.**

## The real defect: the reason was thrown away

```js
// main.js, before
} catch (err) {
  // One video failing must not lose the other eleven.
  console.warn(`[youtube] video ${i + 1} outline failed:`, err.message);
}
```

The reason was logged to a console nobody reads and then discarded, so a 401 and a slow provider
and a captions problem all rendered identically. That is what made this look like a YouTube
problem for a whole debugging session — the same defect class as the swallowed corpus error that
hid the white window.

## What changed

Scoped to `process-youtube-playlist`, as instructed:

- **Both stages now keep their failure reasons** in `transcriptErrors` / `outlineErrors`, write
  them to `boot.log`, and put the first one in the message she actually sees.
- **The final message is classified**, so an auth failure, a spent balance and a timeout each say
  what to do about them instead of "try a shorter playlist".
- **The transcript branch no longer assumes captions are disabled.** It reports timeout,
  rate-limit and "genuinely no captions" as the separate things they are.

## What was deliberately not changed

**The library was not swapped.** `youtube-transcript-nodejs` exists on npm, but at **0.1.0**, and
swapping would have meant: deleting the documented ESM/CJS interop shim that exists because
`youtube-transcript` declares `"type":"module"` while shipping a CommonJS entry; pinning the
caption path to a pre-1.0 package; and rewriting a working dependency to fix a fault it does not
have. That is a large, unverifiable risk taken against a measurement that says the current
library works.

**Fetching stayed parallel.** The plan proposed a sequential loop with a 2.5s delay between videos.
The current implementation fetches captions in parallel (`Promise.allSettled`) with partial
success treated as success — a deliberate design, and the right one: a 12-video playlist finishes
in about the time of its slowest single fetch. Serialising it would add ~30s to every playlist to
avoid rate limits that are not currently being hit. If rate limits ever do appear, the new
transcript classifier will now say so explicitly rather than reporting "captions may be disabled",
and that is the point at which to reconsider.

**No other IPC handler was touched.**

## If captions do fail on her Mac

The two errors now name their own stage, so one screenshot is enough:

| What she sees | Stage that failed | What to do |
|---|---|---|
| "No captions could be retrieved: …" | captions | Read the reason. If it says rate-limited, wait. If it says timed out, check the connection. |
| "DeepSeek rejected the API key …" | DeepSeek auth | Replace the key — this is the failure we can reproduce today. |
| "Every outline request timed out …" | DeepSeek latency | Try a single video. |

If, and only if, she sees the **captions** error with a reason that is not a timeout or a
rate-limit, then the library swap becomes worth testing — and it should be tested standalone,
where the repo lives, before any code changes are made:

```bash
cd "F:\Bianna - Law\Bianna-Law-Final\jsons"
node -e "const fs=require('fs'),p=require('path'),M=require('module');const f=require.resolve('youtube-transcript');const m=new M(f,module);m.filename=f;m.paths=M._nodeModulePaths(p.dirname(f));m._compile(fs.readFileSync(f,'utf8'),f);m.exports.YoutubeTranscript.fetchTranscript('7pmW6lwi-m0').then(s=>console.log('OK',s.length)).catch(e=>console.log('FAIL',e.message))"
```

`OK 41` means the library is fine and the problem is elsewhere, exactly as it is here.

## Unrelated, but blocking the same feature

The DeepSeek default key baked into shipped builds is invalid (HTTP 401 from
`https://api.deepseek.com`). Until the `DEEPSEEK_KEY` repository secret holds a working key, every
AI feature fails on a fresh install — YouTube outlines, chat, the Socratic drills and the formatter
alike. The app's Settings screen lets her paste her own key, which overwrites the default, so the
feature is recoverable at runtime. See `docs/WHITE-SCREEN-ROOT-CAUSE.md` for why this was surfaced
by reading the key out of the shipped artifact.

