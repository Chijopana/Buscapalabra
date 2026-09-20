/**
 * Adivina la Palabra — lógica del juego.
 * Script clásico (sin módulos) para que el juego también funcione
 * abriendo index.html directamente con file://.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config

  var STORAGE_KEY = 'adivina-palabra:v2';
  var SHARE_URL = 'https://buscapalabra.vercel.app/';
  var ALPHABET = 'abcdefghijklmnñopqrstuvwxyz'.split('');
  var KEY_ROWS = ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];

  var HINT_COST = 15;      // puntos que cuesta ver la definición
  var REVEAL_COST = 10;    // puntos que cuesta revelar una letra (además de 1 vida)
  var WIKI_COST = 20;      // puntos que cuesta el dato de Wikipedia
  var DAILY_LIVES = 6;

  // Capa de enriquecimiento. NUNCA decide la palabra: solo añade contexto sobre
  // la que ya eligió el banco local, así el juego sigue entero sin conexión.
  var WIKI_ENDPOINT = 'https://es.wikipedia.org/api/rest_v1/page/summary/';
  var WIKI_CACHE_KEY = 'adivina-palabra:wiki';
  var WIKI_TIMEOUT = 6000;
  var WIKI_TTL = 30 * 24 * 60 * 60 * 1000;   // 30 días
  var WIKI_CACHE_MAX = 150;
  var CENSOR = '▁▁▁▁';

  var difficultyConfig = {
    easy: { label: 'Fácil', maxErrors: 8, maxLetters: 5, bonus: 0, seconds: 90 },
    normal: { label: 'Normal', maxErrors: 6, maxLetters: 8, bonus: 12, seconds: 75 },
    hard: { label: 'Difícil', maxErrors: 5, maxLetters: Infinity, bonus: 28, seconds: 60 }
  };

  var gameModes = {
    classic: {
      label: 'Clásico', icon: '🎯', scored: true, timed: false, unlimited: false,
      desc: 'Partida estándar. Puntúas por vidas restantes, dificultad y rapidez.'
    },
    timed: {
      label: 'Contrarreloj', icon: '⏱️', scored: true, timed: true, unlimited: false,
      desc: 'El reloj corre. Si llega a cero pierdes la ronda.'
    },
    eliminated: {
      label: 'Letras quemadas', icon: '🔥', scored: true, timed: false, unlimited: false,
      desc: 'Cada fallo quema además una letra al azar que ya no podrás usar.'
    },
    multiplier: {
      label: 'Multiplicador', icon: '✖️', scored: true, timed: false, unlimited: false,
      desc: 'Cada acierto seguido sube el multiplicador hasta ×3. Un fallo lo reinicia.'
    },
    practice: {
      label: 'Práctica', icon: '🧪', scored: false, timed: false, unlimited: true,
      desc: 'Fallos ilimitados para entrenar. No puntúa ni cuenta en las estadísticas.'
    }
  };

  var ACHIEVEMENTS = [
    { id: 'primera', icon: '🎯', label: 'Primer triunfo', desc: 'Gana tu primera partida.', test: function (c) { return c.win; } },
    { id: 'racha5', icon: '🔥', label: 'En racha', desc: 'Encadena 5 victorias.', test: function (c) { return c.stats.currentStreak >= 5; } },
    { id: 'racha10', icon: '👑', label: 'Imparable', desc: 'Encadena 10 victorias.', test: function (c) { return c.stats.currentStreak >= 10; } },
    { id: 'perfecta', icon: '💎', label: 'Impecable', desc: 'Gana sin cometer ni un fallo.', test: function (c) { return c.win && c.errors === 0; } },
    { id: 'relampago', icon: '⚡', label: 'Relámpago', desc: 'Gana en menos de 20 segundos.', test: function (c) { return c.win && c.seconds > 0 && c.seconds < 20; } },
    { id: 'cerebrito', icon: '🧠', label: 'Cerebrito', desc: 'Consigue 5 victorias en difícil.', test: function (c) { return c.stats.hardWins >= 5; } },
    { id: 'sinAyuda', icon: '🕶️', label: 'Sin ayuda', desc: 'Gana en difícil sin usar pistas.', test: function (c) { return c.win && c.difficulty === 'hard' && c.hintsUsed === 0; } },
    { id: 'remontada', icon: '🛟', label: 'Remontada', desc: 'Gana con una sola vida restante.', test: function (c) { return c.win && c.livesLeft === 1; } },
    { id: 'veterano', icon: '📚', label: 'Veterano', desc: 'Juega 25 partidas.', test: function (c) { return c.stats.played >= 25; } },
    { id: 'milPuntos', icon: '🏆', label: 'Mil puntos', desc: 'Acumula 1000 puntos.', test: function (c) { return c.stats.totalScore >= 1000; } },
    { id: 'diario', icon: '📅', label: 'Constante', desc: 'Completa un reto diario.', test: function (c) { return c.win && c.daily; } },
    { id: 'explorador', icon: '🌎', label: 'Explorador', desc: 'Gana en 6 categorías distintas.', test: function (c) { return c.stats.categoriesWon.length >= 6; } }
  ];

  var defaultStats = {
    played: 0, wins: 0, losses: 0,
    currentStreak: 0, bestStreak: 0,
    totalScore: 0, hardWins: 0,
    bestTime: null,
    categoriesWon: [],
    achievements: [],
    history: [],
    recent: [],
    daily: null
  };

  // ----------------------------------------------------------------- state

  var state = {
    difficulty: 'normal',
    mode: 'classic',
    theme: null,
    sound: true,
    daily: false,
    stats: clone(defaultStats),

    wordData: null,
    secretWord: '',
    normalizedWord: '',
    revealed: [],
    usedLetters: {},      // letra -> 'hit' | 'miss'
    eliminated: {},
    errors: 0,
    maxErrors: 6,
    combo: 1,
    hintsUsed: 0,
    penalty: 0,
    trail: [],            // 'hit' | 'miss' | 'hint'
    roundScore: 0,
    startedAt: 0,
    seconds: 0,
    timeLeft: 0,
    timeLimit: 0,
    timerId: null,
    finished: false,
    won: false,
    scored: true,
    wiki: null,
    wikiUsed: false,
    wikiToken: 0
  };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bank = Array.isArray(window.WORD_BANK) ? window.WORD_BANK : [];
  var buckets = { easy: [], normal: [], hard: [] };

  // ------------------------------------------------------------- utilities

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function normalize(value) {
    return String(value)
      .toLowerCase()
      .replace(/[áàäâã]/g, 'a')
      .replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i')
      .replace(/[óòöôõ]/g, 'o')
      .replace(/[úùüû]/g, 'u');
  }

  function isLetter(value) {
    return /^[a-zñ]$/.test(value);
  }

  function letterCount(word) {
    return normalize(word).replace(/[^a-zñ]/g, '').length;
  }

  function uniqueLetters(word) {
    var seen = {};
    var total = 0;
    normalize(word).split('').forEach(function (char) {
      if (isLetter(char) && !seen[char]) { seen[char] = true; total += 1; }
    });
    return total;
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /** PRNG determinista: el reto diario debe dar la misma palabra a todo el mundo. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function todayKey() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  function formatTime(seconds) {
    if (seconds == null) return '—';
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
  }

  function buildBuckets() {
    bank.forEach(function (entry) {
      var n = letterCount(entry.word);
      if (n <= difficultyConfig.easy.maxLetters) buckets.easy.push(entry);
      else if (n <= difficultyConfig.normal.maxLetters) buckets.normal.push(entry);
      else buckets.hard.push(entry);
    });
  }

  // --------------------------------------------------------------- storage

  function loadState() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return; // modo privado o almacenamiento bloqueado: se juega sin persistencia
    }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (difficultyConfig[parsed.difficulty]) state.difficulty = parsed.difficulty;
      if (gameModes[parsed.mode]) state.mode = parsed.mode;
      if (parsed.theme === 'dark' || parsed.theme === 'light') state.theme = parsed.theme;
      if (typeof parsed.sound === 'boolean') state.sound = parsed.sound;

      var stats = parsed.stats || {};
      Object.keys(defaultStats).forEach(function (key) {
        var fallback = defaultStats[key];
        var value = stats[key];
        if (Array.isArray(fallback)) state.stats[key] = Array.isArray(value) ? value : [];
        else if (value !== undefined && value !== null) state.stats[key] = value;
      });
    } catch (error) {
      console.warn('Estado guardado ilegible, se empieza de cero.', error);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        difficulty: state.difficulty,
        mode: state.mode,
        theme: state.theme,
        sound: state.sound,
        stats: state.stats
      }));
    } catch (error) {
      /* cuota llena o almacenamiento bloqueado: no es motivo para romper la partida */
    }
  }

  // ------------------------------------------------------------------- wiki

  /** Tapa la palabra secreta (y sus derivados) dentro de un texto. */
  function censor(text, secret) {
    var root = normalize(secret).replace(/[^a-zñ]/g, '');
    // Se recorta la raíz para que también caigan plurales y flexiones
    // ("murciélago" tapa "murciélagos"). Pasarse tapando es inofensivo;
    // quedarse corto destriparía la partida.
    var stem = root.slice(0, Math.max(4, root.length - 2));
    return text.replace(/[\p{L}\p{M}]+/gu, function (word) {
      return normalize(word).indexOf(stem) === 0 ? CENSOR : word;
    });
  }

  /** Corta el extracto en el último punto que quepa, para no dejarlo a medias. */
  function trimExtract(text, maxLength) {
    var clean = String(text).replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    var cut = clean.slice(0, maxLength);
    var lastStop = cut.lastIndexOf('. ');
    return lastStop > maxLength * 0.5 ? cut.slice(0, lastStop + 1) : cut.trim() + '…';
  }

  function readWikiCache() {
    try { return JSON.parse(localStorage.getItem(WIKI_CACHE_KEY)) || {}; } catch (error) { return {}; }
  }

  function writeWikiCache(cache) {
    var keys = Object.keys(cache);
    if (keys.length > WIKI_CACHE_MAX) {
      keys.sort(function (a, b) { return cache[a].ts - cache[b].ts; })
        .slice(0, keys.length - WIKI_CACHE_MAX)
        .forEach(function (key) { delete cache[key]; });
    }
    try { localStorage.setItem(WIKI_CACHE_KEY, JSON.stringify(cache)); } catch (error) { /* cuota */ }
  }

  /**
   * Devuelve una promesa que SIEMPRE resuelve: con los datos del artículo o
   * con null. Un fallo de red, un 404 o una página de desambiguación
   * simplemente dejan la partida sin el extra.
   */
  function fetchWiki(word) {
    var key = normalize(word);
    var cache = readWikiCache();
    var cached = cache[key];
    if (cached && Date.now() - cached.ts < WIKI_TTL) return Promise.resolve(cached.data);
    if (!window.fetch || navigator.onLine === false) return Promise.resolve(null);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, WIKI_TIMEOUT) : null;

    function store(data) {
      if (timer) window.clearTimeout(timer);
      cache[key] = { ts: Date.now(), data: data };
      writeWikiCache(cache);
      return data;
    }

    return fetch(WIKI_ENDPOINT + encodeURIComponent(word), {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json' }
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (json) {
        // 'disambiguation' o sin extracto no sirven como dato.
        if (!json || json.type !== 'standard' || !json.extract) return store(null);
        return store({
          title: json.title || word,
          extract: trimExtract(json.extract, 300),
          url: (json.content_urls && json.content_urls.desktop && json.content_urls.desktop.page) || null,
          thumb: (json.thumbnail && json.thumbnail.source) || null
        });
      })
      .catch(function () {
        if (timer) window.clearTimeout(timer);
        return null;   // sin conexión, CORS bloqueado o timeout: se juega igual
      });
  }

  // ----------------------------------------------------------------- audio

  var audio = (function () {
    var ctx = null;

    function context() {
      if (!state.sound) return null;
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      if (!ctx) {
        try { ctx = new Ctor(); } catch (error) { return null; }
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    function tone(freq, duration, type, volume, delay) {
      var c = context();
      if (!c) return;
      var start = c.currentTime + (delay || 0);
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      // Rampa de entrada y salida: sin ella cada nota suena como un "clic".
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.05, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    }

    return {
      hit: function () { tone(660, 0.1, 'sine', 0.05, 0); },
      miss: function () { tone(190, 0.16, 'sawtooth', 0.035, 0); },
      win: function () {
        [523, 659, 784, 1046].forEach(function (freq, i) { tone(freq, 0.16, 'triangle', 0.05, i * 0.09); });
      },
      lose: function () {
        [330, 262, 196].forEach(function (freq, i) { tone(freq, 0.24, 'triangle', 0.045, i * 0.14); });
      },
      click: function () { tone(440, 0.05, 'square', 0.02, 0); }
    };
  })();

  // -------------------------------------------------------------- elements

  var els = {};
  [
    'bank-size', 'btn-help', 'theme-toggle', 'sound-toggle', 'btn-restart',
    'chip-difficulty', 'chip-mode', 'chip-category', 'chip-daily', 'chip-combo',
    'lives', 'score-total', 'score-round', 'timer', 'timer-bar', 'timer-text',
    'mode-badge', 'hangman', 'streak-value', 'errors-value',
    'word-display', 'sr-status', 'hint-text', 'message',
    'btn-hint-def', 'btn-hint-letter', 'btn-hint-wiki', 'btn-giveup', 'wiki-text',
    'solve-form', 'solve-input', 'btn-solve', 'keyboard',
    'btn-daily', 'daily-status', 'game-mode', 'mode-desc',
    'used-list', 'eliminated-list', 'achievements', 'achievement-count',
    'stat-played', 'stat-wins', 'stat-losses', 'stat-rate', 'stat-streak',
    'stat-best-streak', 'stat-score', 'stat-best-time', 'history-list', 'btn-reset-stats',
    'result-modal', 'result-variant', 'result-title', 'result-word', 'result-hint',
    'result-trail', 'result-score', 'btn-next', 'btn-share', 'btn-close-modal',
    'result-wiki', 'result-wiki-thumb', 'result-wiki-text', 'result-wiki-link',
    'help-modal', 'help-modes', 'btn-close-help',
    'toast-stack', 'confetti-layer'
  ].forEach(function (id) {
    els[id.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = $(id);
  });

  var figureParts = Array.prototype.slice.call(els.hangman.querySelectorAll('.figure-part'));

  // ------------------------------------------------------------- feedback

  var messageTimer = null;

  function setMessage(text, tone) {
    els.message.textContent = text;
    els.message.dataset.tone = tone || 'info';
    els.message.classList.add('show');
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(function () {
      els.message.classList.remove('show');
    }, 2600);
  }

  function toast(text, tone) {
    var node = document.createElement('div');
    node.className = 'toast ' + (tone || 'info');
    node.textContent = text;
    els.toastStack.appendChild(node);
    window.setTimeout(function () {
      node.classList.add('hide');
      window.setTimeout(function () { node.remove(); }, 320);
    }, 2600);
  }

  function shake(element) {
    if (reduceMotion || !element) return;
    element.classList.remove('shake');
    void element.offsetWidth; // fuerza reflow para poder relanzar la animación
    element.classList.add('shake');
  }

  function confetti() {
    if (reduceMotion) return;
    var palette = ['#e9c46a', '#2a9d8f', '#e76f51', '#f4a261', '#8ecae6'];
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 46; i += 1) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = (Math.random() * 100) + '%';
      piece.style.background = palette[i % palette.length];
      piece.style.animationDelay = (Math.random() * 0.7).toFixed(2) + 's';
      piece.style.animationDuration = (2.2 + Math.random() * 1.2).toFixed(2) + 's';
      fragment.appendChild(piece);
    }
    els.confettiLayer.appendChild(fragment);
    window.setTimeout(function () { els.confettiLayer.innerHTML = ''; }, 3600);
  }

  // ---------------------------------------------------------------- render

  function renderTheme() {
    document.body.dataset.theme = state.theme;
    els.themeToggle.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0b0d18' : '#f5efe5');
  }

  function renderSound() {
    els.soundToggle.textContent = state.sound ? '🔊' : '🔇';
    els.soundToggle.setAttribute('aria-pressed', String(state.sound));
  }

  function renderWord() {
    var letters = state.secretWord.split('');
    els.wordDisplay.innerHTML = '';
    els.wordDisplay.style.setProperty('--cells', String(letters.length));

    letters.forEach(function (char, index) {
      var cell = document.createElement('span');
      var visible = state.revealed[index];
      cell.className = 'word-cell' + (char === ' ' ? ' space' : '') + (visible ? ' visible' : '');
      cell.textContent = char === ' ' ? '' : (visible ? char : '');
      els.wordDisplay.appendChild(cell);
    });

    var spoken = letters.map(function (char, index) {
      if (char === ' ') return ',';
      return state.revealed[index] ? char : 'blanco';
    }).join(' ');
    els.srStatus.textContent = state.secretWord
      ? 'Palabra de ' + letterCount(state.secretWord) + ' letras: ' + spoken + '.'
      : 'Cargando palabra.';
  }

  function renderKeyboard() {
    els.keyboard.innerHTML = '';
    KEY_ROWS.forEach(function (row) {
      var rowNode = document.createElement('div');
      rowNode.className = 'key-row';
      row.split('').forEach(function (letter) {
        var button = document.createElement('button');
        var status = state.usedLetters[letter];
        button.type = 'button';
        button.className = 'key';
        button.dataset.letter = letter;
        button.textContent = letter.toUpperCase();

        if (status) button.classList.add(status === 'hit' ? 'hit' : 'miss');
        if (state.eliminated[letter]) button.classList.add('burned');
        button.disabled = state.finished || !state.secretWord || !!status || !!state.eliminated[letter];

        var label = 'Letra ' + letter.toUpperCase();
        if (status === 'hit') label += ', acertada';
        else if (status === 'miss') label += ', fallada';
        else if (state.eliminated[letter]) label += ', quemada';
        button.setAttribute('aria-label', label);

        rowNode.appendChild(button);
      });
      els.keyboard.appendChild(rowNode);
    });
  }

  function renderLives() {
    els.lives.innerHTML = '';
    if (gameModes[state.mode].unlimited) {
      var infinite = document.createElement('span');
      infinite.className = 'lives-infinite';
      infinite.textContent = '∞ vidas';
      els.lives.appendChild(infinite);
      return;
    }
    for (var i = 0; i < state.maxErrors; i += 1) {
      var heart = document.createElement('span');
      heart.className = 'life' + (i < state.maxErrors - state.errors ? '' : ' spent');
      heart.textContent = '♥';
      els.lives.appendChild(heart);
    }
    els.lives.setAttribute('aria-label', (state.maxErrors - state.errors) + ' de ' + state.maxErrors + ' vidas');
  }

  function renderHangman() {
    var shown = state.errors === 0
      ? 0
      : Math.min(figureParts.length, Math.ceil((state.errors / state.maxErrors) * figureParts.length));
    figureParts.forEach(function (part, index) {
      part.classList.toggle('on', index < shown);
    });
    els.errorsValue.textContent = gameModes[state.mode].unlimited
      ? String(state.errors)
      : state.errors + '/' + state.maxErrors;
  }

  function renderChips() {
    var difficulty = difficultyConfig[state.difficulty];
    var mode = gameModes[state.mode];

    els.chipDifficulty.textContent = state.daily ? 'Diario' : difficulty.label;
    els.chipMode.textContent = mode.icon + ' ' + mode.label;
    els.chipCategory.textContent = 'Categoría: ' + (state.wordData ? state.wordData.category : '—');
    els.modeBadge.textContent = (state.daily ? 'Reto diario' : mode.label).toUpperCase();
    els.chipDaily.hidden = !state.daily;
    els.modeDesc.textContent = mode.desc;

    var showCombo = state.mode === 'multiplier' && !state.finished;
    els.chipCombo.hidden = !showCombo;
    if (showCombo) els.chipCombo.textContent = '✖️ ' + state.combo.toFixed(1);
  }

  function renderScore() {
    els.scoreTotal.textContent = Math.round(state.stats.totalScore);
    els.scoreRound.textContent = state.finished ? Math.round(state.roundScore) : projectedScore();
  }

  function renderUsedLetters() {
    var hits = [];
    var misses = [];
    Object.keys(state.usedLetters).forEach(function (letter) {
      (state.usedLetters[letter] === 'hit' ? hits : misses).push(letter.toUpperCase());
    });

    els.usedList.innerHTML = '';
    if (!hits.length && !misses.length) {
      var empty = document.createElement('span');
      empty.className = 'empty-state';
      empty.textContent = 'Aún no has probado ninguna letra.';
      els.usedList.appendChild(empty);
    } else {
      [['hit', '✔', hits], ['miss', '✘', misses]].forEach(function (group) {
        if (!group[2].length) return;
        var line = document.createElement('div');
        line.className = 'used-line ' + group[0];
        line.textContent = group[1] + ' ' + group[2].join(' · ');
        els.usedList.appendChild(line);
      });
    }

    var burned = Object.keys(state.eliminated).map(function (l) { return l.toUpperCase(); });
    els.eliminatedList.hidden = !burned.length;
    els.eliminatedList.textContent = burned.length ? '🔥 Quemadas: ' + burned.join(' · ') : '';
  }

  function renderStats() {
    var s = state.stats;
    var rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    els.statPlayed.textContent = s.played;
    els.statWins.textContent = s.wins;
    els.statLosses.textContent = s.losses;
    els.statRate.textContent = rate + '%';
    els.statStreak.textContent = s.currentStreak;
    els.statBestStreak.textContent = s.bestStreak;
    els.statScore.textContent = Math.round(s.totalScore);
    els.statBestTime.textContent = formatTime(s.bestTime);
    els.streakValue.textContent = s.currentStreak;

    els.historyList.innerHTML = '';
    if (!s.history.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Todavía no hay partidas registradas.';
      els.historyList.appendChild(empty);
      return;
    }

    s.history.slice(0, 12).forEach(function (entry) {
      var item = document.createElement('article');
      item.className = 'history-item ' + (entry.result === 'win' ? 'win' : 'lose');

      var left = document.createElement('div');
      var word = document.createElement('strong');
      word.textContent = String(entry.word).toUpperCase();
      var meta = document.createElement('p');
      meta.textContent = entry.mode + ' · ' + entry.difficulty + (entry.seconds != null ? ' · ' + formatTime(entry.seconds) : '');
      left.appendChild(word);
      left.appendChild(meta);

      var right = document.createElement('span');
      right.textContent = entry.result === 'win' ? '+' + Math.round(entry.score) : '✘';

      item.appendChild(left);
      item.appendChild(right);
      els.historyList.appendChild(item);
    });
  }

  function renderAchievements() {
    var unlocked = state.stats.achievements;
    els.achievements.innerHTML = '';
    ACHIEVEMENTS.forEach(function (achievement) {
      var isUnlocked = unlocked.indexOf(achievement.id) !== -1;
      var node = document.createElement('div');
      node.className = 'achievement' + (isUnlocked ? ' unlocked' : '');
      node.title = achievement.label + ' — ' + achievement.desc;
      node.setAttribute('role', 'listitem');
      node.setAttribute('aria-label', achievement.label + '. ' + achievement.desc + ' ' + (isUnlocked ? 'Desbloqueado.' : 'Bloqueado.'));

      var icon = document.createElement('span');
      icon.className = 'achievement-icon';
      icon.textContent = achievement.icon;
      var name = document.createElement('span');
      name.className = 'achievement-label';
      name.textContent = achievement.label;

      node.appendChild(icon);
      node.appendChild(name);
      els.achievements.appendChild(node);
    });
    els.achievementCount.textContent = unlocked.length;
  }

  function renderDailyButton() {
    var daily = state.stats.daily;
    var done = daily && daily.date === todayKey();
    els.btnDaily.classList.toggle('active', state.daily);
    els.btnDaily.classList.toggle('done', !!done);
    els.dailyStatus.textContent = done
      ? (daily.result === 'win' ? '✅ Resuelto hoy · ' + daily.score + ' pts' : '❌ Fallado hoy, vuelve mañana')
      : 'La misma palabra para todos';
  }

  function renderTimer() {
    var showTimer = state.timeLimit > 0;
    els.timer.hidden = !showTimer;
    if (!showTimer) return;
    var ratio = Math.max(0, state.timeLeft / state.timeLimit);
    els.timerBar.style.transform = 'scaleX(' + ratio + ')';
    els.timerBar.classList.toggle('low', ratio <= 0.25);
    els.timerText.textContent = Math.max(0, state.timeLeft) + 's';
  }

  function renderControls() {
    var active = !state.finished && !!state.secretWord;
    els.btnHintDef.disabled = !active || !els.hintText.hidden;
    els.btnHintLetter.disabled = !active || (!gameModes[state.mode].unlimited && state.maxErrors - state.errors <= 1);
    els.btnGiveup.disabled = !active;
    els.btnHintWiki.hidden = !state.wiki || !active;
    els.btnHintWiki.disabled = !active || state.wikiUsed;
    els.solveInput.disabled = !active;
    els.btnSolve.disabled = !active;
  }

  function renderAll() {
    renderChips();
    renderWord();
    renderKeyboard();
    renderLives();
    renderHangman();
    renderUsedLetters();
    renderScore();
    renderTimer();
    renderControls();
  }

  // ----------------------------------------------------------- word choice

  function chooseWord() {
    if (state.daily) {
      var seed = Number(todayKey().replace(/-/g, ''));
      var random = mulberry32(seed);
      // Se descartan unos valores para que días consecutivos no queden correlacionados.
      random(); random(); random();
      return bank[Math.floor(random() * bank.length)];
    }

    var pool = buckets[state.difficulty];
    if (!pool.length) pool = bank;

    // Evita repetir lo recién jugado, pero nunca deja el pool vacío.
    var recent = state.stats.recent || [];
    var memory = Math.min(recent.length, Math.max(0, pool.length - 3));
    var blocked = recent.slice(0, memory);
    var fresh = pool.filter(function (entry) { return blocked.indexOf(entry.word) === -1; });
    return pickRandom(fresh.length ? fresh : pool);
  }

  function rememberWord(word) {
    var recent = state.stats.recent || [];
    recent.unshift(word);
    state.stats.recent = recent.slice(0, 20);
  }

  // -------------------------------------------------------------- scoring

  function projectedScore() {
    if (!state.scored || !state.secretWord) return 0;
    return Math.max(0, computeScore(elapsedSeconds()));
  }

  function computeScore(seconds) {
    var config = state.daily
      ? { bonus: difficultyConfig.normal.bonus }
      : difficultyConfig[state.difficulty];
    var livesLeft = Math.max(0, state.maxErrors - state.errors);

    var base = uniqueLetters(state.secretWord) * 4;
    var difficultyBonus = config.bonus;
    var livesBonus = livesLeft * 5;
    var speedBonus = Math.max(0, 45 - seconds);

    var multiplier = state.mode === 'multiplier'
      ? state.combo
      : 1 + Math.min(0.5, state.stats.currentStreak * 0.05);

    return Math.max(0, Math.round((base + difficultyBonus + livesBonus + speedBonus) * multiplier) - state.penalty);
  }

  function elapsedSeconds() {
    if (!state.startedAt) return 0;
    return Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  }

  // ----------------------------------------------------------------- timer

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  function startTimer() {
    stopTimer();
    var mode = gameModes[state.mode];
    state.timeLimit = mode.timed && !state.daily ? difficultyConfig[state.difficulty].seconds : 0;
    state.timeLeft = state.timeLimit;
    renderTimer();
    if (!state.timeLimit) return;

    state.timerId = window.setInterval(function () {
      if (state.finished || document.hidden) return; // el reloj se pausa con la pestaña oculta
      state.timeLeft -= 1;
      renderTimer();
      renderScore();
      if (state.timeLeft <= 5 && state.timeLeft > 0) audio.click();
      if (state.timeLeft <= 0) finishRound(false, 'Se acabó el tiempo');
    }, 1000);
  }

  // ------------------------------------------------------------ game flow

  function startRound() {
    closeDialog(els.resultModal);
    stopTimer();

    state.finished = false;
    state.won = false;
    state.revealed = [];
    state.usedLetters = {};
    state.eliminated = {};
    state.errors = 0;
    state.combo = 1;
    state.hintsUsed = 0;
    state.penalty = 0;
    state.trail = [];
    state.roundScore = 0;
    state.seconds = 0;
    state.startedAt = Date.now();
    state.wiki = null;
    state.wikiUsed = false;

    var dailyRecord = state.stats.daily;
    var dailyDone = state.daily && dailyRecord && dailyRecord.date === todayKey();
    state.scored = gameModes[state.mode].scored && !dailyDone;
    state.maxErrors = state.daily ? DAILY_LIVES : difficultyConfig[state.difficulty].maxErrors;

    var entry = chooseWord();
    state.wordData = entry;
    state.secretWord = entry.word;
    state.normalizedWord = normalize(entry.word);
    state.revealed = entry.word.split('').map(function (char) {
      return !isLetter(normalize(char)); // espacios y guiones se muestran desde el principio
    });
    if (!state.daily) rememberWord(entry.word);

    els.hintText.hidden = true;
    els.hintText.textContent = '';
    els.wikiText.hidden = true;
    els.wikiText.textContent = '';
    els.resultWiki.hidden = true;
    els.solveInput.value = '';
    els.message.classList.remove('show');

    startTimer();
    renderAll();
    renderDailyButton();

    // Enriquecimiento en segundo plano: la partida ya es jugable sin esperar.
    var wikiToken = (state.wikiToken += 1);
    fetchWiki(entry.word).then(function (data) {
      if (wikiToken !== state.wikiToken) return;   // llegó tarde, ya hay otra ronda
      state.wiki = data;
      renderControls();
      if (state.finished) renderResultWiki();
    });

    if (dailyDone) toast('Ya jugaste el reto de hoy: esta ronda no puntúa.', 'warning');
    if (!state.scored && state.mode === 'practice') toast('Modo práctica: no cuenta en estadísticas.', 'info');
  }

  function revealLetter(letter) {
    var found = false;
    state.secretWord.split('').forEach(function (char, index) {
      if (normalize(char) === letter) {
        state.revealed[index] = true;
        found = true;
      }
    });
    return found;
  }

  function isSolved() {
    return state.revealed.length > 0 && state.revealed.every(Boolean);
  }

  function burnRandomLetter() {
    var candidates = ALPHABET.filter(function (letter) {
      return !state.usedLetters[letter]
        && !state.eliminated[letter]
        && state.normalizedWord.indexOf(letter) === -1; // nunca quema una letra necesaria
    });
    if (!candidates.length) return;
    state.eliminated[pickRandom(candidates)] = true;
  }

  function guessLetter(rawLetter) {
    if (state.finished || !state.secretWord) return;
    var letter = normalize(String(rawLetter).trim()).slice(0, 1);
    if (!isLetter(letter)) return;

    if (state.usedLetters[letter] || state.eliminated[letter]) {
      setMessage('Esa letra ya no está disponible.', 'warning');
      return;
    }

    var hit = revealLetter(letter);
    state.usedLetters[letter] = hit ? 'hit' : 'miss';
    state.trail.push(hit ? 'hit' : 'miss');

    if (hit) {
      if (state.mode === 'multiplier') state.combo = Math.min(3, state.combo + 0.15);
      setMessage('¡Bien! Va la ' + letter.toUpperCase(), 'success');
      audio.hit();
    } else {
      state.errors += 1;
      state.combo = 1;
      if (state.mode === 'eliminated') burnRandomLetter();
      setMessage('La ' + letter.toUpperCase() + ' no está', 'error');
      audio.miss();
      shake(els.hangman);
    }

    renderAll();

    if (isSolved()) return finishRound(true);
    if (!gameModes[state.mode].unlimited && state.errors >= state.maxErrors) {
      finishRound(false, 'Te quedaste sin vidas');
    }
  }

  function useDefinitionHint() {
    if (state.finished || !state.wordData || !els.hintText.hidden) return;
    els.hintText.textContent = '💡 ' + state.wordData.hint;
    els.hintText.hidden = false;
    state.hintsUsed += 1;
    state.penalty += HINT_COST;
    state.trail.push('hint');
    renderControls();
    renderScore();
    toast('Pista revelada (−' + HINT_COST + ' pts)', 'warning');
  }

  function useWikiHint() {
    if (state.finished || !state.wiki || state.wikiUsed) return;
    state.wikiUsed = true;
    state.hintsUsed += 1;
    state.penalty += WIKI_COST;
    state.trail.push('hint');
    els.wikiText.textContent = '🌐 ' + censor(state.wiki.extract, state.secretWord);
    els.wikiText.hidden = false;
    renderControls();
    renderScore();
    toast('Dato de Wikipedia (−' + WIKI_COST + ' pts)', 'warning');
  }

  function useLetterHint() {
    if (state.finished || !state.secretWord) return;
    var hidden = [];
    state.secretWord.split('').forEach(function (char, index) {
      var letter = normalize(char);
      if (!state.revealed[index] && isLetter(letter) && hidden.indexOf(letter) === -1) hidden.push(letter);
    });
    if (!hidden.length) return;

    var letter = pickRandom(hidden);
    revealLetter(letter);
    state.usedLetters[letter] = 'hit';
    state.hintsUsed += 1;
    state.penalty += REVEAL_COST;
    state.trail.push('hint');
    state.errors += 1;
    delete state.eliminated[letter];

    setMessage('Te regalo la ' + letter.toUpperCase(), 'warning');
    audio.hit();
    renderAll();

    if (isSolved()) return finishRound(true);
    if (!gameModes[state.mode].unlimited && state.errors >= state.maxErrors) {
      finishRound(false, 'Te quedaste sin vidas');
    }
  }

  function trySolve(guess) {
    if (state.finished || !state.secretWord) return;
    var attempt = normalize(guess).replace(/\s+/g, ' ').trim();
    if (!attempt) return;

    if (attempt === state.normalizedWord.replace(/\s+/g, ' ').trim()) {
      state.revealed = state.revealed.map(function () { return true; });
      state.secretWord.split('').forEach(function (char) {
        var letter = normalize(char);
        if (isLetter(letter) && !state.usedLetters[letter]) state.usedLetters[letter] = 'hit';
      });
      renderAll();
      finishRound(true);
      return;
    }

    state.errors += 1;
    state.combo = 1;
    state.trail.push('miss');
    els.solveInput.value = '';
    setMessage('No es esa palabra', 'error');
    audio.miss();
    shake(els.solveInput);
    renderAll();

    if (!gameModes[state.mode].unlimited && state.errors >= state.maxErrors) {
      finishRound(false, 'Te quedaste sin vidas');
    }
  }

  function giveUp() {
    if (state.finished) return;
    state.errors = gameModes[state.mode].unlimited ? state.errors : state.maxErrors;
    finishRound(false, 'Te rendiste');
  }

  function finishRound(win, reason) {
    if (state.finished) return;
    state.finished = true;
    state.won = !!win;
    stopTimer();
    state.seconds = elapsedSeconds();
    state.revealed = state.revealed.map(function () { return true; });

    var livesLeft = Math.max(0, state.maxErrors - state.errors);
    state.roundScore = win && state.scored ? computeScore(state.seconds) : 0;

    if (state.scored) {
      var s = state.stats;
      s.played += 1;
      if (win) {
        s.wins += 1;
        s.currentStreak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
        s.totalScore += state.roundScore;
        if (!state.daily && state.difficulty === 'hard') s.hardWins += 1;
        if (s.bestTime == null || state.seconds < s.bestTime) s.bestTime = state.seconds;
        if (state.wordData && s.categoriesWon.indexOf(state.wordData.category) === -1) {
          s.categoriesWon.push(state.wordData.category);
        }
      } else {
        s.losses += 1;
        s.currentStreak = 0;
      }

      s.history.unshift({
        result: win ? 'win' : 'lose',
        word: state.secretWord,
        mode: state.daily ? 'Reto diario' : gameModes[state.mode].label,
        difficulty: state.daily ? 'Diario' : difficultyConfig[state.difficulty].label,
        score: state.roundScore,
        seconds: state.seconds,
        date: new Date().toISOString()
      });
      s.history = s.history.slice(0, 30);

      if (state.daily) {
        s.daily = { date: todayKey(), result: win ? 'win' : 'lose', score: state.roundScore };
      }

      unlockAchievements({
        stats: s, win: win, errors: state.errors, livesLeft: livesLeft,
        difficulty: state.difficulty, mode: state.mode, seconds: state.seconds,
        hintsUsed: state.hintsUsed, daily: state.daily
      });
      saveState();
    }

    if (win) {
      setMessage('¡Palabra resuelta!', 'success');
      audio.win();
      confetti();
    } else {
      setMessage(reason || 'Ronda perdida', 'error');
      audio.lose();
    }

    renderAll();
    renderStats();
    renderAchievements();
    renderDailyButton();
    openResult(win, reason);
  }

  function unlockAchievements(context) {
    var unlocked = state.stats.achievements;
    ACHIEVEMENTS.forEach(function (achievement) {
      if (unlocked.indexOf(achievement.id) !== -1) return;
      var passes = false;
      try { passes = !!achievement.test(context); } catch (error) { passes = false; }
      if (!passes) return;
      unlocked.push(achievement.id);
      toast('🏅 Logro: ' + achievement.label, 'success');
    });
  }

  // ---------------------------------------------------------------- modals

  function openDialog(dialog) {
    if (!dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog.open) return;
    if (dialog.close) dialog.close();
    else dialog.removeAttribute('open');
  }

  function openResult(win, reason) {
    els.resultVariant.textContent = win ? 'Victoria' : 'Derrota';
    els.resultTitle.textContent = win ? '¡La tienes!' : (reason || 'Fin de la ronda');
    els.resultWord.textContent = state.secretWord.toUpperCase();
    els.resultHint.textContent = state.wordData
      ? state.wordData.category + ' · ' + state.wordData.hint
      : '';
    els.resultTrail.textContent = trailEmoji();
    els.resultScore.textContent = state.scored
      ? (win ? '+' + state.roundScore + ' puntos · ' + formatTime(state.seconds) + ' · racha ' + state.stats.currentStreak
        : 'Sin puntos · racha reiniciada')
      : 'Ronda de práctica: no puntúa.';
    renderResultWiki();
    els.resultModal.dataset.result = win ? 'win' : 'lose';
    openDialog(els.resultModal);
    els.btnNext.focus();
  }

  function renderResultWiki() {
    var data = state.wiki;
    els.resultWiki.hidden = !data;
    if (!data) return;

    els.resultWikiText.textContent = data.extract;
    els.resultWikiThumb.hidden = !data.thumb;
    if (data.thumb) {
      els.resultWikiThumb.src = data.thumb;
      els.resultWikiThumb.alt = data.title;
    }
    els.resultWikiLink.hidden = !data.url;
    if (data.url) els.resultWikiLink.href = data.url;
  }

  function trailEmoji() {
    return state.trail.map(function (kind) {
      if (kind === 'hit') return '🟩';
      if (kind === 'hint') return '🟨';
      return '🟥';
    }).join('');
  }

  function shareResult() {
    var won = state.won;
    var header = '🧠 Adivina la Palabra — ' + (state.daily ? 'Reto diario ' + todayKey() : gameModes[state.mode].label + ' · ' + difficultyConfig[state.difficulty].label);
    var subject = state.daily
      ? letterCount(state.secretWord) + ' letras ' + (won ? '✅' : '❌')
      : state.secretWord.toUpperCase() + ' ' + (won ? '✅' : '❌');
    var stats = '⏱ ' + formatTime(state.seconds)
      + ' · ♥ ' + Math.max(0, state.maxErrors - state.errors) + '/' + state.maxErrors
      + (state.scored ? ' · ⭐ ' + state.roundScore : '');

    var text = [header, subject, trailEmoji(), stats, SHARE_URL].join('\n');

    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      area.remove();
      toast(ok ? 'Resultado copiado' : 'No se pudo copiar', ok ? 'success' : 'error');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Resultado copiado al portapapeles', 'success');
      }, fallback);
    } else {
      fallback();
    }
  }

  function renderHelpModes() {
    els.helpModes.innerHTML = '';
    Object.keys(gameModes).forEach(function (key) {
      var mode = gameModes[key];
      var item = document.createElement('li');
      var name = document.createElement('strong');
      name.textContent = mode.icon + ' ' + mode.label + ': ';
      item.appendChild(name);
      item.appendChild(document.createTextNode(mode.desc));
      els.helpModes.appendChild(item);
    });
  }

  // ---------------------------------------------------------------- events

  function isTypingTarget(node) {
    if (!node) return false;
    var tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
  }

  function bindEvents() {
    els.keyboard.addEventListener('click', function (event) {
      var key = event.target.closest('.key');
      if (key && !key.disabled) guessLetter(key.dataset.letter);
    });

    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (isTypingTarget(document.activeElement)) return;
      if (event.key.length !== 1) return;
      var letter = normalize(event.key);
      if (isLetter(letter)) {
        event.preventDefault();
        guessLetter(letter);
      }
    });

    els.solveForm.addEventListener('submit', function (event) {
      event.preventDefault();
      trySolve(els.solveInput.value);
    });

    els.btnRestart.addEventListener('click', function () {
      state.daily = false;
      startRound();
      renderDailyButton();
    });

    els.btnNext.addEventListener('click', function () {
      state.daily = false;
      startRound();
      renderDailyButton();
    });

    els.btnHintDef.addEventListener('click', useDefinitionHint);
    els.btnHintLetter.addEventListener('click', useLetterHint);
    els.btnHintWiki.addEventListener('click', useWikiHint);
    els.btnGiveup.addEventListener('click', giveUp);
    els.btnShare.addEventListener('click', shareResult);
    els.btnCloseModal.addEventListener('click', function () { closeDialog(els.resultModal); });

    els.btnHelp.addEventListener('click', function () { openDialog(els.helpModal); });
    els.btnCloseHelp.addEventListener('click', function () { closeDialog(els.helpModal); });

    // Cerrar al pulsar fuera del contenido del diálogo.
    [els.resultModal, els.helpModal].forEach(function (dialog) {
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    });

    els.btnDaily.addEventListener('click', function () {
      state.daily = !state.daily;
      startRound();
      renderDailyButton();
    });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="difficulty"]'), function (radio) {
      radio.checked = radio.value === state.difficulty;
      radio.addEventListener('change', function (event) {
        state.difficulty = event.target.value;
        state.daily = false;
        saveState();
        startRound();
        renderDailyButton();
      });
    });

    els.gameMode.value = state.mode;
    els.gameMode.addEventListener('change', function (event) {
      state.mode = event.target.value;
      saveState();
      startRound();
    });

    els.themeToggle.addEventListener('click', function () {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      renderTheme();
      saveState();
    });

    els.soundToggle.addEventListener('click', function () {
      state.sound = !state.sound;
      renderSound();
      saveState();
      if (state.sound) audio.hit();
    });

    els.btnResetStats.addEventListener('click', function () {
      if (!window.confirm('¿Borrar todas tus estadísticas y logros? No se puede deshacer.')) return;
      state.stats = clone(defaultStats);
      saveState();
      renderStats();
      renderAchievements();
      renderDailyButton();
      renderScore();
      toast('Estadísticas borradas', 'info');
    });

    // El temporizador se pausa solo; al volver hay que refrescar la barra.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) renderTimer();
    });
  }

  // ------------------------------------------------------------------ init

  function init() {
    if (!bank.length) {
      els.message.textContent = 'No se pudo cargar el banco de palabras.';
      els.message.classList.add('show');
      return;
    }

    buildBuckets();
    loadState();

    if (!state.theme) {
      var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      state.theme = prefersLight ? 'light' : 'dark';
    }

    els.bankSize.textContent = bank.length;
    renderTheme();
    renderSound();
    renderHelpModes();
    renderStats();
    renderAchievements();
    renderDailyButton();
    bindEvents();
    startRound();
  }

  init();
})();
