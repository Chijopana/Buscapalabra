const STORAGE_KEY = 'adivina-palabra:state';
const ALPHABET = 'abcdefghijklmnñopqrstuvwxyz'.split('');
const USE_REMOTE_WORDS = false;
const WORD_API_URLS = [
  'https://palabras-aleatorias-api.herokuapp.com/all',
  'https://random-word-api.herokuapp.com/all?lang=es',
  'https://random-word-api.herokuapp.com/all',
];

const difficultyConfig = {
  easy: { label: 'Fácil', maxErrors: 10, minLength: 3, maxLength: 6 },
  normal: { label: 'Normal', maxErrors: 8, minLength: 5, maxLength: 10 },
  hard: { label: 'Difícil', maxErrors: 6, minLength: 7, maxLength: 24 },
};

const gameModes = {
  classic: { label: 'Clásico', timeLimit: null, unlimitedErrors: false },
  timed: { label: 'Contrarreloj', timeLimit: 60, unlimitedErrors: false },
  unlimited: { label: 'Unlimited', timeLimit: null, unlimitedErrors: true },
  eliminated: { label: 'Letras eliminadas', timeLimit: null, unlimitedErrors: false },
  multiplier: { label: 'Multiplicador', timeLimit: null, unlimitedErrors: false },
};

const localWords = {
  easy: [
    { word: 'gato', category: 'Animales' },
    { word: 'casa', category: 'Objetos' },
    { word: 'libro', category: 'Objetos' },
    { word: 'sol', category: 'Naturaleza' },
    { word: 'mar', category: 'Naturaleza' },
    { word: 'árbol', category: 'Naturaleza' },
    { word: 'música', category: 'Arte' },
    { word: 'teléfono', category: 'Tecnología' },
  ],
  normal: [
    { word: 'computadora', category: 'Tecnología' },
    { word: 'programación', category: 'Tecnología' },
    { word: 'javascript', category: 'Tecnología' },
    { word: 'desarrollo', category: 'Tecnología' },
    { word: 'aventura', category: 'General' },
    { word: 'españa', category: 'Países' },
    { word: 'argentina', category: 'Países' },
    { word: 'profesor', category: 'Profesiones' },
  ],
  hard: [
    { word: 'programador', category: 'Profesiones' },
    { word: 'inteligencia artificial', category: 'Tecnología' },
    { word: 'desarrollador web', category: 'Profesiones' },
    { word: 'arquitectura de software', category: 'Tecnología' },
    { word: 'optimización', category: 'Tecnología' },
    { word: 'latinoamérica', category: 'Regiones' },
    { word: 'elefante', category: 'Animales' },
    { word: 'extraordinario', category: 'Adjetivos' },
  ],
};

const defaults = {
  difficulty: 'easy',
  mode: 'classic',
  theme: 'dark',
  sound: true,
  stats: {
    played: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    totalScore: 0,
    hardWins: 0,
    perfectWins: 0,
    fastestWins: [],
    history: [],
    badges: [],
  },
};

const els = {
  body: document.body,
  difficultyLabel: document.getElementById('difficulty-label'),
  modeLabel: document.getElementById('mode-label'),
  categoryLabel: document.getElementById('category-label'),
  timerLabel: document.getElementById('timer-label'),
  score: document.getElementById('score'),
  streak: document.getElementById('streak-value'),
  word: document.getElementById('current_word'),
  input: document.getElementById('letra'),
  verify: document.getElementById('btn'),
  restart: document.getElementById('btn-restart'),
  message: document.getElementById('message'),
  resultBanner: document.getElementById('result-banner'),
  keyboard: document.getElementById('keyboard'),
  usedList: document.getElementById('used-list'),
  eliminatedList: document.getElementById('eliminated-list'),
  hangmanSteps: Array.from(document.querySelectorAll('.hangman-step')),
  statPlayed: document.getElementById('stat-played'),
  statWins: document.getElementById('stat-wins'),
  statLosses: document.getElementById('stat-losses'),
  statRate: document.getElementById('stat-rate'),
  statStreak: document.getElementById('stat-streak'),
  statScore: document.getElementById('stat-score'),
  historyList: document.getElementById('history-list'),
  themeToggle: document.getElementById('theme-toggle'),
  soundToggle: document.getElementById('sound-toggle'),
  gameMode: document.getElementById('game-mode'),
  resultModal: document.getElementById('resultModal'),
  resultTitle: document.getElementById('result-title'),
  resultVariant: document.getElementById('result-variant'),
  resultWord: document.getElementById('result-word'),
  resultScore: document.getElementById('result-score'),
  nextGame: document.getElementById('next-game'),
  closeModal: document.getElementById('close-modal'),
  confettiLayer: document.getElementById('confetti-layer'),
  toastStack: document.getElementById('toast-stack'),
  modeBadge: document.getElementById('mode-badge'),
};

const state = {
  difficulty: defaults.difficulty,
  mode: defaults.mode,
  theme: defaults.theme,
  sound: defaults.sound,
  stats: structuredClone(defaults.stats),
  wordData: null,
  secretWord: '',
  normalizedWord: '',
  revealed: [],
  usedLetters: new Set(),
  eliminatedLetters: new Set(),
  errors: 0,
  roundScore: 0,
  combo: 1,
  timeLeft: 0,
  roundStartedAt: 0,
  roundDuration: 0,
  timerId: null,
  finished: false,
  roundToken: 0,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.difficulty = parsed.difficulty || defaults.difficulty;
    state.mode = parsed.mode || defaults.mode;
    state.theme = parsed.theme || defaults.theme;
    state.sound = typeof parsed.sound === 'boolean' ? parsed.sound : defaults.sound;
    state.stats = { ...structuredClone(defaults.stats), ...(parsed.stats || {}) };
    state.stats.fastestWins = Array.isArray(state.stats.fastestWins) ? state.stats.fastestWins : [];
    state.stats.history = Array.isArray(state.stats.history) ? state.stats.history : [];
    state.stats.badges = Array.isArray(state.stats.badges) ? state.stats.badges : [];
  } catch (error) {
    console.warn('No se pudo cargar el estado guardado', error);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      difficulty: state.difficulty,
      mode: state.mode,
      theme: state.theme,
      sound: state.sound,
      stats: state.stats,
    })
  );
}

function normalizeWord(value) {
  return value
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u');
}

function isLetter(value) {
  return /^[a-záéíóúüñ]$/i.test(value);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function updateTheme() {
  document.body.dataset.theme = state.theme;
  els.themeToggle.textContent = state.theme === 'dark' ? '☀' : '☾';
}

function updateSoundButton() {
  els.soundToggle.textContent = state.sound ? '🔊' : '🔇';
}

function getVisibleMaxErrors() {
  return gameModes[state.mode].unlimitedErrors ? '∞' : difficultyConfig[state.difficulty].maxErrors;
}

function getWordLengthLimits() {
  const config = difficultyConfig[state.difficulty];
  return { minLength: config.minLength, maxLength: config.maxLength };
}

function getLocalWord(mode) {
  return pickRandom(localWords[mode]);
}

function sanitizeApiWords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.words)) return payload.words;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

async function fetchWordForMode(mode) {
  const localWord = getLocalWord(mode);

  if (!USE_REMOTE_WORDS) {
    return { ...localWord, source: 'local' };
  }

  const { minLength, maxLength } = getWordLengthLimits();
  for (const url of WORD_API_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('API no disponible');
      const payload = await response.json();
      const words = sanitizeApiWords(payload)
        .map((word) => String(word).trim())
        .filter((word) => {
          const normalized = normalizeWord(word).replace(/\s+/g, '');
          return normalized.length >= minLength && normalized.length <= maxLength && /^[a-zñ\s-]+$/i.test(word);
        });

      if (words.length > 0) {
        return { word: pickRandom(words), category: 'General', source: 'api' };
      }
    } catch (error) {
      console.warn('API de palabras no disponible, usando banco local', error);
    }
  }

  return { ...localWord, source: 'local' };
}

function renderWord() {
  els.word.innerHTML = Array.from(state.revealed)
    .map((visible, index) => {
      const char = state.secretWord[index];
      const classes = ['word-cell'];
      if (char === ' ') classes.push('space');
      if (visible) classes.push('visible');
      return `<span class="${classes.join(' ')}">${char === ' ' ? '&nbsp;' : visible ? escapeHtml(char) : '&nbsp;'}</span>`;
    })
    .join('');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderKeyboard() {
  els.keyboard.innerHTML = '';
  for (const letter of ALPHABET) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'key';
    button.dataset.letter = letter;
    button.textContent = letter.toUpperCase();
    button.disabled = state.finished || state.usedLetters.has(letter) || state.eliminatedLetters.has(letter);
    if (state.usedLetters.has(letter)) button.classList.add('used');
    if (state.eliminatedLetters.has(letter)) button.classList.add('eliminated');
    button.addEventListener('click', () => guessLetter(letter));
    els.keyboard.appendChild(button);
  }
}

function renderUsedLetters() {
  const used = Array.from(state.usedLetters).map((letter) => letter.toUpperCase());
  els.usedList.textContent = used.length ? used.join(' · ') : 'Aún no has usado letras.';

  const eliminated = Array.from(state.eliminatedLetters).map((letter) => letter.toUpperCase());
  els.eliminatedList.textContent = eliminated.length
    ? `Eliminadas: ${eliminated.join(' · ')}`
    : state.mode === 'eliminated'
      ? 'En este modo se elimina una letra extra en cada error.'
      : '';
}

function renderStats() {
  const { played, wins, losses, currentStreak, totalScore } = state.stats;
  const rate = played ? Math.round((wins / played) * 100) : 0;
  els.statPlayed.textContent = played;
  els.statWins.textContent = wins;
  els.statLosses.textContent = losses;
  els.statRate.textContent = `${rate}%`;
  els.statStreak.textContent = currentStreak;
  els.statScore.textContent = Math.round(totalScore);
  els.streak.textContent = currentStreak;

  els.historyList.innerHTML = state.stats.history.length
    ? state.stats.history.slice(0, 10).map((entry) => {
        const resultClass = entry.result === 'win' ? 'win' : 'lose';
        return `
          <article class="history-item ${resultClass}">
            <div>
              <strong>${entry.word.toUpperCase()}</strong>
              <p>${entry.mode} · ${entry.difficulty}</p>
            </div>
            <span>${entry.result === 'win' ? `+${Math.round(entry.score)}` : '0'}</span>
          </article>
        `;
      }).join('')
    : '<p class="empty-state">Todavía no hay partidas guardadas.</p>';
}

function renderModeInfo() {
  const difficulty = difficultyConfig[state.difficulty];
  const mode = gameModes[state.mode];
  els.difficultyLabel.textContent = difficulty.label;
  els.modeLabel.textContent = mode.label;
  els.modeBadge.textContent = mode.label.toUpperCase();
  els.categoryLabel.textContent = `Categoría: ${state.wordData?.category || 'General'}`;
  els.timerLabel.textContent = mode.timeLimit ? `Tiempo: ${state.timeLeft}s` : 'Tiempo: libre';
}

function renderHangman() {
  els.hangmanSteps.forEach((step, index) => {
    step.style.opacity = index < state.errors ? '1' : '0.12';
  });
}

function setMessage(text, tone = 'info') {
  els.message.textContent = text;
  els.message.dataset.tone = tone;
  els.message.classList.add('show');
  window.clearTimeout(setMessage.timer);
  setMessage.timer = window.setTimeout(() => {
    els.message.classList.remove('show');
  }, 2600);
}

function toast(text, tone = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = text;
  els.toastStack.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('hide');
    window.setTimeout(() => node.remove(), 300);
  }, 2400);
}

function playTone(frequency, duration) {
  if (!state.sound || typeof window.AudioContext === 'undefined') return;
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  window.setTimeout(() => {
    oscillator.stop();
    audioContext.close();
  }, duration);
}

function triggerConfetti() {
  els.confettiLayer.innerHTML = '';
  const palette = ['#ff9f1c', '#2ec4b6', '#e71d36', '#ffd166', '#8ecae6'];
  for (let index = 0; index < 42; index += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = palette[index % palette.length];
    piece.style.animationDelay = `${Math.random() * 0.8}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    els.confettiLayer.appendChild(piece);
  }
  window.setTimeout(() => {
    els.confettiLayer.innerHTML = '';
  }, 3200);
}

function updateAchievementBadges() {
  const badges = new Set(state.stats.badges);
  if (state.stats.wins >= 1) badges.add('Principiante');
  if (state.stats.currentStreak >= 5) badges.add('En Racha');
  if (state.roundScore > 0 && state.timeLeft > 0 && state.timeLeft <= 20) badges.add('Rápido');
  if (state.stats.hardWins >= 5) badges.add('Cerebrito');
  if (state.stats.perfectWins >= 1) badges.add('Perfecto');
  if (state.stats.totalScore >= 1000) badges.add('Punto de Oro');
  state.stats.badges = Array.from(badges);
}

function announceBadges() {
  const labels = new Set(state.stats.badges);
  if (labels.has('Principiante') && state.stats.wins === 1) toast('Logro desbloqueado: Principiante', 'success');
  if (labels.has('En Racha') && state.stats.currentStreak === 5) toast('Logro desbloqueado: En Racha', 'success');
  if (labels.has('Rápido') && state.roundScore > 0 && state.timeLeft <= 20) toast('Logro desbloqueado: Rápido', 'success');
  if (labels.has('Cerebrito') && state.stats.hardWins === 5) toast('Logro desbloqueado: Cerebrito', 'success');
  if (labels.has('Perfecto') && state.stats.perfectWins === 1) toast('Logro desbloqueado: Perfecto', 'success');
  if (labels.has('Punto de Oro') && state.stats.totalScore >= 1000) toast('Logro desbloqueado: Punto de Oro', 'success');
}

function calculatePoints() {
  const base = 10;
  const speedBonus = state.mode === 'timed'
    ? (state.timeLeft > 0 && state.timeLeft < 30 ? 5 : 0)
    : (state.roundDuration > 0 && state.roundDuration < 30 ? 5 : 0);
  const avoidedErrors = Math.max(0, difficultyConfig[state.difficulty].maxErrors - state.errors);
  const errorBonus = avoidedErrors * 2;
  const streakMultiplier = 1 + Math.max(0, state.stats.currentStreak - 1) * 0.2;
  const roundMultiplier = state.mode === 'multiplier' ? state.combo : streakMultiplier;
  return Math.round((base + speedBonus + errorBonus) * roundMultiplier);
}

function pushHistory(result) {
  state.stats.history.unshift({
    result,
    word: state.secretWord,
    mode: gameModes[state.mode].label,
    difficulty: difficultyConfig[state.difficulty].label,
    score: state.roundScore,
    time: state.mode === 'timed' ? 60 - state.timeLeft : null,
    date: new Date().toISOString(),
  });
  state.stats.history = state.stats.history.slice(0, 10);
}

function updateFastestRankings() {
  if (state.roundScore <= 0) return;
  const timeSpent = state.mode === 'timed' ? 60 - state.timeLeft : state.roundDuration || state.errors;
  state.stats.fastestWins.push({
    word: state.secretWord,
    timeSpent,
    score: state.roundScore,
    date: new Date().toISOString(),
  });
  state.stats.fastestWins = state.stats.fastestWins
    .sort((a, b) => a.timeSpent - b.timeSpent)
    .slice(0, 10);
}

function openResultModal(win) {
  els.resultModal.hidden = false;
  els.resultTitle.textContent = win ? '¡Ganaste!' : 'Partida terminada';
  els.resultVariant.textContent = win ? 'Victoria' : 'Derrota';
  els.resultWord.textContent = `Palabra: ${state.secretWord.toUpperCase()} · Categoría: ${state.wordData?.category || 'General'}`;
  els.resultScore.textContent = `Puntos obtenidos: ${Math.round(state.roundScore)} · Racha: ${state.stats.currentStreak}`;
}

function closeResultModal() {
  els.resultModal.hidden = true;
}

function finishGame(win, reason = '') {
  if (state.finished) return;
  state.finished = true;
  state.roundDuration = state.roundStartedAt ? Math.max(0, Math.round((Date.now() - state.roundStartedAt) / 1000)) : 0;
  window.clearInterval(state.timerId);
  state.timerId = null;

  state.stats.played += 1;
  if (win) {
    state.stats.wins += 1;
    state.stats.currentStreak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.currentStreak);
    if (state.difficulty === 'hard') state.stats.hardWins += 1;
    if (state.errors === 0) state.stats.perfectWins += 1;
    state.roundScore = calculatePoints();
    state.stats.totalScore += state.roundScore;
    updateFastestRankings();
    updateAchievementBadges();
    announceBadges();
    pushHistory('win');
    triggerConfetti();
    playTone(880, 140);
    toast(`Ganaste +${Math.round(state.roundScore)} puntos`, 'success');
    setMessage('¡Palabra completada!', 'success');
  } else {
    state.stats.losses += 1;
    state.stats.currentStreak = 0;
    state.roundScore = 0;
    pushHistory('lose');
    playTone(220, 220);
    setMessage(reason || 'Perdiste esta ronda', 'error');
  }

  saveState();
  renderStats();
  renderKeyboard();
  renderUsedLetters();
  renderHangman();
  renderModeInfo();
  openResultModal(win);
  updateScoreboard();
}

function updateScoreboard() {
  els.score.textContent = `Puntuación: ${Math.round(state.stats.totalScore)} | Ronda: ${Math.round(state.roundScore)}`;
}

function applyTimedMode() {
  window.clearInterval(state.timerId);
  if (gameModes[state.mode].timeLimit) {
    state.timeLeft = gameModes[state.mode].timeLimit;
    renderModeInfo();
    state.timerId = window.setInterval(() => {
      if (state.finished) return;
      state.timeLeft -= 1;
      renderModeInfo();
      if (state.timeLeft <= 0) {
        finishGame(false, 'Se acabó el tiempo');
      }
    }, 1000);
  } else {
    state.timeLeft = 0;
    renderModeInfo();
  }
}

function resetRoundState() {
  state.wordData = null;
  state.secretWord = '';
  state.normalizedWord = '';
  state.revealed = [];
  state.usedLetters = new Set();
  state.eliminatedLetters = new Set();
  state.errors = 0;
  state.roundScore = 0;
  state.combo = 1;
  state.finished = false;
}

function startGame() {
  closeResultModal();
  resetRoundState();
  state.roundToken += 1;
  const activeRoundToken = state.roundToken;
  state.roundStartedAt = Date.now();
  renderUsedLetters();
  renderStats();
  renderKeyboard();
  renderHangman();
  els.resultBanner.hidden = true;
  els.input.value = '';
  els.input.disabled = false;
  els.verify.disabled = false;
  els.input.focus();
  applyTimedMode();
  updateScoreboard();
  renderModeInfo();

  fetchWordForMode(state.difficulty).then((wordData) => {
    if (activeRoundToken !== state.roundToken || state.finished) return;
    state.wordData = wordData;
    state.secretWord = wordData.word;
    state.normalizedWord = normalizeWord(wordData.word);
    state.revealed = Array.from(state.secretWord).map((char) => !isLetter(char));
    renderWord();
    renderModeInfo();
    renderUsedLetters();
    renderKeyboard();
    toast(`Palabra cargada desde ${wordData.source === 'local' ? 'el banco local' : 'la API'}`, 'info');
  });
}

function eliminateExtraLetter() {
  const candidates = ALPHABET.filter((letter) => !state.usedLetters.has(letter) && !state.eliminatedLetters.has(letter));
  if (!candidates.length) return;
  state.eliminatedLetters.add(pickRandom(candidates));
}

function revealLetter(letter) {
  let found = false;
  Array.from(state.secretWord).forEach((char, index) => {
    if (!isLetter(char)) return;
    if (normalizeWord(char) === letter) {
      state.revealed[index] = true;
      found = true;
    }
  });
  return found;
}

function isSolved() {
  return state.revealed.every(Boolean);
}

function guessLetter(rawLetter) {
  if (state.finished || !state.secretWord) return;

  const letter = normalizeWord(String(rawLetter).trim()).slice(0, 1);
  if (!isLetter(letter)) return;

  els.input.value = '';
  els.input.focus();

  if (state.usedLetters.has(letter) || state.eliminatedLetters.has(letter)) {
    setMessage('Esa letra ya no está disponible.', 'warning');
    toast('Letra repetida', 'warning');
    return;
  }

  state.usedLetters.add(letter);

  const hit = revealLetter(letter);
  if (hit) {
    if (state.mode === 'multiplier') {
      state.combo = Math.min(2.5, state.combo + 0.1);
    }
    setMessage(`Bien: ${letter.toUpperCase()}`, 'success');
    playTone(660, 90);
  } else {
    state.errors += 1;
    state.combo = 1;
    if (state.mode === 'eliminated') {
      eliminateExtraLetter();
    }
    setMessage(`La letra ${letter.toUpperCase()} no está`, 'error');
    playTone(180, 140);
  }

  renderWord();
  renderKeyboard();
  renderUsedLetters();
  renderHangman();
  updateScoreboard();
  renderModeInfo();

  if (isSolved()) {
    finishGame(true);
    return;
  }

  const maxErrors = difficultyConfig[state.difficulty].maxErrors;
  if (!gameModes[state.mode].unlimitedErrors && state.errors >= maxErrors) {
    finishGame(false, 'Se acabaron los intentos');
  }
}

function applyThemeAndSound() {
  updateTheme();
  updateSoundButton();
  saveState();
}

document.querySelectorAll('input[name="difficulty"]').forEach((radio) => {
  radio.checked = radio.value === state.difficulty;
  radio.addEventListener('change', (event) => {
    state.difficulty = event.target.value;
    saveState();
    startGame();
  });
});

els.gameMode.value = state.mode;
els.gameMode.addEventListener('change', (event) => {
  state.mode = event.target.value;
  saveState();
  startGame();
});

els.verify.addEventListener('click', () => guessLetter(els.input.value));
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    guessLetter(els.input.value);
  }
});

els.restart.addEventListener('click', startGame);
els.nextGame.addEventListener('click', startGame);
els.closeModal.addEventListener('click', closeResultModal);

els.themeToggle.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyThemeAndSound();
});

els.soundToggle.addEventListener('click', () => {
  state.sound = !state.sound;
  applyThemeAndSound();
  toast(state.sound ? 'Sonido activado' : 'Sonido desactivado', 'info');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeResultModal();
    return;
  }

  if (event.key === 'Enter' && document.activeElement !== els.input) {
    guessLetter(els.input.value);
    return;
  }

  if (event.key.length === 1) {
    const letter = normalizeWord(event.key).slice(0, 1);
    if (isLetter(letter)) {
      guessLetter(letter);
    }
  }
});

loadState();
applyThemeAndSound();
renderStats();
renderModeInfo();
startGame();