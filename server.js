require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '\n[warning] ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n' +
    'The app will still serve static pages, but free-response grading will fail.\n'
  );
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Live grading endpoint -------------------------------------------------
// This is the ONLY runtime call to the model. Everything else (word content,
// MCQ checking, fill-in-the-blank checking, spaced-repetition scheduling)
// is pre-generated once (see scripts/generate-content.js) or plain client-side
// logic, to keep token usage low.
//
// Used for open-ended "what does this sentence mean" style answers, where an
// exact string match isn't possible and we need semantic judgment.
app.post('/api/grade', async (req, res) => {
  const { word, definition, question, userAnswer } = req.body || {};

  if (!word || !question || typeof userAnswer !== 'string') {
    return res.status(400).json({ error: 'word, question, and userAnswer are required' });
  }

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
        'You are a strict but fair SAT vocabulary grader. You will be given a target word, ' +
        'its correct definition, a question the student was asked, and the student\'s answer. ' +
        'Judge ONLY whether the student\'s answer demonstrates correct understanding of the ' +
        'word\'s meaning in context. Minor phrasing differences are fine. Reply with ONLY a ' +
        'compact JSON object, no other text, in this exact shape: ' +
        '{"correct": true|false, "feedback": "one short sentence, max 20 words"}',
      messages: [
        {
          role: 'user',
          content:
            `Word: ${word}\n` +
            `Correct definition: ${definition || '(not provided)'}\n` +
            `Question asked: ${question}\n` +
            `Student's answer: ${userAnswer}`,
        },
      ],
    });

    const rawText = msg.content?.[0]?.text?.trim() || '{}';
    // Haiku sometimes wraps the JSON in a ```json ... ``` fence despite
    // being told not to. Strip that before parsing.
    const text = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Fall back to a conservative default if the model didn't return clean JSON.
      parsed = { correct: false, feedback: 'Could not parse grading response. Try again.' };
    }
    res.json(parsed);
  } catch (err) {
    console.error('Grading error:', err.message);
    res.status(500).json({ error: 'Grading request failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`Word drill app running at http://localhost:${PORT}`);
});
