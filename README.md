# Word Drill

A small, self-hosted SAT vocabulary trainer. Teaches each word once
(definition, etymology, a memorable mnemonic, an example sentence), then
drills you with multiple-choice, fill-in-the-blank, and free-response
questions, and brings back the words you get wrong using a Leitner-style
spaced repetition schedule until they stick.

## Why it's built this way (token cost notes)

- **Word content (definition/etymology/mnemonic/sentence/quiz options) is
  generated ONCE per word** by `scripts/generate-content.js` and cached to
  `public/data/words.json`. It is never regenerated at study time. For a
  200-500 word SAT list this is a one-time, cheap batch job (words are sent
  in batches of 8 per request to cut overhead further).
- **Spaced repetition scheduling is plain JavaScript**, not the model. Which
  words are due, how "mastered" a word is, none of that touches the API.
- **Multiple-choice and fill-in-the-blank grading is exact-match code**, not
  the model.
- **The only live API call during practice** is grading free-response
  "explain what this means" answers (`/api/grade`), and even that's rare by
  design: easier/newer words mostly get MCQ or fill-in questions; the
  free-response question type only shows up more often once a word is
  further along. Each grading call is short (~200 output tokens) and uses
  Haiku.
- **Progress is stored in the browser (localStorage)**, per device, not in a
  database. You chose per-device tracking over cross-device sync, so there's
  no backend state to run or pay for beyond the two API endpoints above.
- **No image generation, no assembly.ai.** Mnemonics are vivid *described*
  mental images (the classic vocab "keyword method"), which the research on
  memory for vocabulary treats as roughly as effective as a real picture,
  at zero extra cost or complexity.

## Setup

```bash
cd word-drill
npm install
cp .env.example .env
# edit .env and paste your Anthropic API key
```

Check `.env` for the current Haiku model ID (they get renamed over time,
`https://docs.claude.com/en/docs/about-claude/models` has the current list).

## The word list

`data/wordlist.txt` is a real, post-2024 Digital SAT list: 501 unique words,
merged and deduped from two current (2026) sources:

- [College Transitions, "455 of the Best Digital SAT Vocab Words to Know in 2026"](https://www.collegetransitions.com/blog/sat-vocabulary-words-list/)
- [OnePrep, "SAT Vocabulary Words 2026: High-Impact List + Strategy"](https://www.oneprep.com/blog/sat-vocabulary-words-2026)

These are built for the current "Words in Context" question type, not the
old paper-SAT sentence-completion style, so it's a right-sized list rather
than a legacy 3500-5000 word mega-list. `data/wordlist.sample.txt` (the
original 10-word demo list) is still there if you want a tiny test run
first.

Generate the content (this is the step that spends tokens, and only needs
to run once, or again later if you add more words):

```bash
npm run generate
# or: node scripts/generate-content.js data/wordlist.txt
```

This writes `public/data/words.json`. Re-running the script only generates
words that aren't already cached there, so it's safe to re-run after adding
new words. Use `--force` to regenerate everything. At 501 words in batches
of 8 (~63 requests), expect this to take several minutes and cost roughly
$1-2 at current Haiku 4.5 pricing.

## Run it locally

```bash
npm start
```

Open `http://localhost:3000` on your laptop. To try it on your iPhone
before deploying anywhere, make sure both devices are on the same wifi,
find your laptop's local IP (`ipconfig getifaddr en0` on a Mac), and visit
`http://<that-ip>:3000` in Safari.

## Deploying to sat.aphasia.ai (GitHub + Vercel)

Vercel now runs Express apps with effectively zero config (confirmed
against Vercel's current docs as of mid-2026) as long as `server.js` stays
at the repo root exporting or listening the way it already does here, and
static files stay under `public/`, both already true in this repo. One
thing to know: on Vercel, `public/**` is served directly off their CDN, so
`express.static()` in `server.js` is simply ignored there (it still works
for local `npm start`) - no code change needed either way.

1. **Push to GitHub**

   ```bash
   git remote add origin <your-new-repo-url>
   git push -u origin main
   ```

2. **Import into Vercel**
   - Vercel dashboard -> Add New -> Project -> import the GitHub repo.
   - Framework preset: it should auto-detect Node/Express (or just Other,
     no build command needed).
   - Under Project Settings -> Environment Variables, add:
     - `ANTHROPIC_API_KEY` = your key
     - `CLAUDE_MODEL` = whatever's current in `.env.example`
   - Deploy.

3. **Attach the custom domain**
   - Project Settings -> Domains -> Add `sat.aphasia.ai`.
   - Vercel will show you a CNAME record to add at whatever registrar/DNS
     host aphasia.ai's DNS is managed at. Add that record, wait for it to
     verify (usually a few minutes).
   - Leave `app.aphasia.ai` and the rest of your DNS untouched, this only
     adds one new subdomain record.

Progress is stored per-device (localStorage), not synced through Vercel,
so your laptop and phone will track separate practice streaks unless you
always use the same device, same as running it locally.

## Files

```
server.js                    Express server: serves the app + /api/grade
scripts/generate-content.js  One-time batch content generator (run manually)
data/wordlist.txt            Real 501-word post-2024 SAT list (merged, deduped)
data/wordlist.sample.txt     Original 10-word demo list
public/index.html/.css/.js   The app itself
public/data/words.json       Generated content cache (created by the script)
```
