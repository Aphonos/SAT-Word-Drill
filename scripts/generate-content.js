/*
 * One-time (well, one-per-word) batch content generator.
 *
 * Reads a plain-text word list and calls Claude Haiku ONCE per batch of
 * words (not once per session, not once per word) to produce all the
 * teaching + quiz content for each word. Results are cached to
 * public/data/words.json and re-used forever by the app. Re-running this
 * script skips words already present in the cache, so it's cheap and safe
 * to re-run if you add new words to your list later.
 *
 * Usage:
 *   node scripts/generate-content.js [path/to/wordlist.txt] [--force]
 *
 * --force regenerates every word even if already cached.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const BATCH_SIZE = 8;
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'words.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const listPathArg = args.find((a) => !a.startsWith('--'));
const listPath = listPathArg
  ? path.resolve(listPathArg)
  : path.join(__dirname, '..', 'data', 'wordlist.sample.txt');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function loadWordList(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function loadExisting() {
  if (fs.existsSync(OUT_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const SYSTEM_PROMPT = `You are an expert SAT vocabulary tutor writing content for a study app.
For each word given, produce a JSON object with this exact shape:

{
  "word": "the word as given",
  "partOfSpeech": "e.g. adjective, noun, verb",
  "definition": "one clear, concise definition, SAT-register",
  "etymology": "1-2 sentences on word origin/roots, highlighting any roots that help recognize the word elsewhere",
  "mnemonic": "a vivid, slightly absurd, easy-to-picture mental image or word-association trick that makes the word memorable. Describe the image in words, do not just restate the etymology.",
  "exampleSentence": "one natural, memorable sentence using the word correctly, SAT-register, 12-24 words",
  "fillInSentence": "the exampleSentence but with the target word replaced by '_____'",
  "meaningQuestion": "a question asking the student to explain, in their own words, what the exampleSentence means or implies, WITHOUT naming the target word in the question",
  "mcqDistractors": ["three plausible-but-wrong short definitions, similar length/style to the real definition, that a student who half-knows the word might pick"]
}

Reply with ONLY a JSON array of these objects, one per input word, in the same order as given. No prose, no markdown fences, no commentary.`;

async function generateBatch(words) {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Words: ${words.join(', ')}` }],
  });

  const text = msg.content?.[0]?.text?.trim() || '[]';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

async function main() {
  const words = loadWordList(listPath);
  const existing = force ? {} : loadExisting();

  const todo = words.filter((w) => !existing[w.toLowerCase()]);
  console.log(`Word list: ${words.length} words. Already cached: ${words.length - todo.length}. To generate: ${todo.length}.`);

  if (todo.length === 0) {
    console.log('Nothing to do. Use --force to regenerate everything.');
    return;
  }

  const batches = chunk(todo, BATCH_SIZE);
  let done = 0;

  for (const batch of batches) {
    process.stdout.write(`Generating batch of ${batch.length} (${done}/${todo.length} done so far)... `);
    try {
      const results = await generateBatch(batch);
      for (const entry of results) {
        if (entry && entry.word) {
          existing[entry.word.toLowerCase()] = entry;
        }
      }
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`  Batch [${batch.join(', ')}] failed: ${err.message}`);
      console.error('  Skipping this batch. Re-run the script later to retry just these words.');
    }
    done += batch.length;
    // Write progress after every batch so a crash/interrupt doesn't lose earlier work.
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  }

  console.log(`\nDone. ${Object.keys(existing).length} words cached in ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
