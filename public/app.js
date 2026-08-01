(() => {
  'use strict';

  // ---- Spaced repetition config ------------------------------------------
  // Simple Leitner system. Index = "box". Value = days until next due after
  // a correct answer at that box. Wrong answer always resets to box 0.
  const BOX_INTERVALS = [0, 1, 2, 4, 7, 14, 30, 60];
  const MASTERED_BOX = 6; // box >= this counts as "mastered" for the stats line
  const SESSION_SIZE = 12;
  const MAX_NEW_PER_SESSION = 5;
  const STORAGE_KEY = 'word-drill-progress-v1';

  // ---- State ---------------------------------------------------------------
  let WORDS = {}; // word -> content, loaded from /data/words.json
  let progress = loadProgress();
  let queue = [];
  let queueIndex = 0;
  let sessionStats = { correct: 0, wrong: 0 };
  let currentQuestionType = null;
  let pendingGrade = false;

  // ---- Persistence -----------------------------------------------------
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function isDue(word) {
    const p = progress[word];
    if (!p) return true; // never seen = due (needs teaching)
    return new Date(p.due).getTime() <= Date.now();
  }

  function isNew(word) {
    return !progress[word];
  }

  function recordAnswer(word, correct) {
    const p = progress[word] || { box: -1, correctCount: 0, wrongCount: 0 };
    if (correct) {
      p.box = Math.min(p.box + 1, BOX_INTERVALS.length - 1);
      p.correctCount = (p.correctCount || 0) + 1;
    } else {
      p.box = 0;
      p.wrongCount = (p.wrongCount || 0) + 1;
    }
    const days = BOX_INTERVALS[Math.max(p.box, 0)];
    const due = new Date();
    due.setDate(due.getDate() + days);
    p.due = due.toISOString();
    p.lastSeen = new Date().toISOString();
    progress[word] = p;
    saveProgress();
  }

  function markTaught(word) {
    progress[word] = progress[word] || { box: 0, correctCount: 0, wrongCount: 0, due: new Date().toISOString() };
    saveProgress();
  }

  // ---- Utilities -------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }

  function fillAnswerCorrect(word, input) {
    const a = word.trim().toLowerCase();
    const b = input.trim().toLowerCase();
    if (a === b) return true;
    if (a.length >= 5) return levenshtein(a, b) <= 1; // small typo tolerance
    return false;
  }

  // ---- DOM refs ----------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const screens = {
    home: el('home'), teach: el('teach'), quiz: el('quiz'),
    sessionEnd: el('sessionEnd'), browse: el('browse'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  // ---- Home / stats ------------------------------------------------------
  function refreshHome() {
    const allWords = Object.keys(WORDS);
    const due = allWords.filter(isDue).length;
    const mastered = allWords.filter((w) => progress[w] && progress[w].box >= MASTERED_BOX).length;
    el('dueCount').textContent = due === 0
      ? 'Nothing due right now. Nice work.'
      : `${due} word${due === 1 ? '' : 's'} due for practice`;
    el('stats').textContent = `${mastered}/${allWords.length} mastered`;
  }

  // ---- Session building ----------------------------------------------------
  function buildQueue() {
    const allWords = Object.keys(WORDS);
    const dueWords = allWords.filter(isDue);

    // Prioritize: lowest box first (most struggled), new words capped so a
    // session isn't 100% brand-new material.
    const newOnes = shuffle(dueWords.filter(isNew)).slice(0, MAX_NEW_PER_SESSION);
    const reviewOnes = dueWords
      .filter((w) => !isNew(w))
      .sort((a, b) => (progress[a].box - progress[b].box));

    const combined = shuffle([...reviewOnes, ...newOnes]).slice(0, SESSION_SIZE);
    // Make sure at least the neediest review words aren't crowded out by shuffle
    if (combined.length < SESSION_SIZE) {
      const extra = reviewOnes.filter((w) => !combined.includes(w));
      combined.push(...extra.slice(0, SESSION_SIZE - combined.length));
    }
    return combined;
  }

  function startSession() {
    queue = buildQueue();
    queueIndex = 0;
    sessionStats = { correct: 0, wrong: 0 };
    if (queue.length === 0) {
      el('sessionSummary').textContent = 'No words are due right now, come back later.';
      showScreen('sessionEnd');
      return;
    }
    nextInQueue();
  }

  function nextInQueue() {
    if (queueIndex >= queue.length) {
      el('sessionSummary').textContent =
        `${sessionStats.correct} correct, ${sessionStats.wrong} to review again.`;
      showScreen('sessionEnd');
      refreshHome();
      return;
    }
    const word = queue[queueIndex];
    if (isNew(word)) {
      renderTeach(word);
    } else {
      renderQuiz(word);
    }
  }

  // ---- Teach screen --------------------------------------------------------
  function renderTeach(word) {
    const w = WORDS[word];
    el('teachWord').textContent = w.word;
    el('teachPOS').textContent = w.partOfSpeech || '';
    el('teachDefinition').textContent = w.definition;
    el('teachEtymology').textContent = w.etymology;
    el('teachMnemonic').textContent = w.mnemonic;
    el('teachSentence').textContent = w.exampleSentence;
    showScreen('teach');
  }

  el('teachNextBtn').addEventListener('click', () => {
    const word = queue[queueIndex];
    markTaught(word);
    renderQuiz(word);
  });

  // ---- Quiz screen -----------------------------------------------------
  function pickQuestionType(box) {
    if (box <= 1) return Math.random() < 0.5 ? 'mcq' : 'fill';
    const r = Math.random();
    if (r < 0.4) return 'mcq';
    if (r < 0.7) return 'fill';
    return 'meaning';
  }

  function renderQuiz(word) {
    const w = WORDS[word];
    const box = (progress[word] && progress[word].box) || 0;
    currentQuestionType = pickQuestionType(box);

    el('progressFill').style.width = `${Math.round((queueIndex / queue.length) * 100)}%`;
    el('quizPOS').textContent = w.partOfSpeech || '';
    el('feedback').classList.add('hidden');
    ['mcqArea', 'fillArea', 'freeArea'].forEach((id) => el(id).classList.add('hidden'));

    if (currentQuestionType === 'mcq') {
      el('quizPrompt').textContent = `What does "${w.word}" mean?`;
      const options = shuffle([w.definition, ...(w.mcqDistractors || [])]);
      const area = el('mcqArea');
      area.innerHTML = '';
      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = 'mcq-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => handleMcqAnswer(word, opt, btn, options));
        area.appendChild(btn);
      });
      area.classList.remove('hidden');
    } else if (currentQuestionType === 'fill') {
      el('quizPrompt').textContent = w.fillInSentence;
      el('fillInput').value = '';
      el('fillArea').classList.remove('hidden');
      el('fillInput').focus();
    } else {
      el('quizPrompt').textContent = `${w.exampleSentence}\n\n${w.meaningQuestion}`;
      el('freeInput').value = '';
      el('freeArea').classList.remove('hidden');
    }

    showScreen('quiz');
  }

  function handleMcqAnswer(word, chosen, btnEl, allOptions) {
    if (pendingGrade) return;
    const w = WORDS[word];
    const correct = chosen === w.definition;
    document.querySelectorAll('.mcq-option').forEach((b) => {
      b.disabled = true;
      if (b.textContent === w.definition) b.classList.add('correct');
      else if (b === btnEl) b.classList.add('incorrect');
    });
    finishAnswer(word, correct, correct ? 'Correct.' : `Not quite. "${word}" means: ${w.definition}`);
  }

  el('fillSubmit').addEventListener('click', () => {
    if (pendingGrade) return;
    const word = queue[queueIndex];
    const w = WORDS[word];
    const val = el('fillInput').value;
    const correct = fillAnswerCorrect(word, val);
    finishAnswer(word, correct, correct ? 'Correct.' : `The word was "${word}": ${w.definition}`);
  });

  el('freeSubmit').addEventListener('click', async () => {
    if (pendingGrade) return;
    const word = queue[queueIndex];
    const w = WORDS[word];
    const val = el('freeInput').value.trim();
    if (!val) return;
    pendingGrade = true;
    el('freeSubmit').textContent = 'Checking...';
    el('freeSubmit').disabled = true;
    try {
      const res = await fetch('/api/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          definition: w.definition,
          question: w.meaningQuestion,
          userAnswer: val,
        }),
      });
      const data = await res.json();
      const correct = !!data.correct;
      const feedback = data.feedback || (correct ? 'Correct.' : `Correct meaning: ${w.definition}`);
      finishAnswer(word, correct, feedback);
    } catch (err) {
      finishAnswer(word, false, 'Grading failed (network issue). Marked as needing review.');
    } finally {
      pendingGrade = false;
      el('freeSubmit').textContent = 'Check';
      el('freeSubmit').disabled = false;
    }
  });

  function finishAnswer(word, correct, feedbackText) {
    recordAnswer(word, correct);
    if (correct) sessionStats.correct++; else sessionStats.wrong++;

    const fb = el('feedbackText');
    fb.textContent = feedbackText;
    fb.className = correct ? 'correct' : 'incorrect';
    el('feedback').classList.remove('hidden');
  }

  el('continueBtn').addEventListener('click', () => {
    queueIndex++;
    nextInQueue();
  });

  // ---- Browse screen -------------------------------------------------------
  function renderBrowse() {
    const container = el('browseList');
    container.innerHTML = '';
    const words = Object.keys(WORDS).sort();
    words.forEach((word) => {
      const w = WORDS[word];
      const p = progress[word];
      const label = !p ? 'New' : p.box >= MASTERED_BOX ? 'Mastered' : p.box === 0 ? 'Learning' : 'Reviewing';
      const row = document.createElement('div');
      row.className = 'browse-row';
      row.innerHTML = `<span>${w.word}</span><span class="box-tag">${label}</span>`;
      container.appendChild(row);
    });
  }

  // ---- Nav ----------------------------------------------------------------
  el('startBtn').addEventListener('click', startSession);
  el('browseBtn').addEventListener('click', () => { renderBrowse(); showScreen('browse'); });
  el('browseBackBtn').addEventListener('click', () => { refreshHome(); showScreen('home'); });
  el('backHomeBtn').addEventListener('click', () => { refreshHome(); showScreen('home'); });

  // ---- Boot ----------------------------------------------------------------
  fetch('data/words.json')
    .then((r) => {
      if (!r.ok) throw new Error('words.json not found');
      return r.json();
    })
    .then((data) => {
      WORDS = data;
      refreshHome();
      showScreen('home');
    })
    .catch(() => {
      el('dueCount').textContent =
        'No word content found. Run "npm run generate" first (see README).';
    });
})();
