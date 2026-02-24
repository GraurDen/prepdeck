// ========================================
// PrepDeck — Flashcard App Logic
// Pure JS, no dependencies
// ========================================

(function () {
  'use strict';

  // ---- Storage Keys ----
  const STORAGE_SM2 = 'prepdeck_sm2';
  const STORAGE_LEARNED = 'prepdeck_learned'; // legacy, for migration
  const STORAGE_CUSTOM_QUESTIONS = 'prepdeck_custom_questions';
  const STORAGE_CATEGORIES = 'prepdeck_categories';
  const STORAGE_STUDY_DAYS = 'prepdeck_study_days';
  const STORAGE_THEME = 'prepdeck_theme';

  // ---- Validation Limits ----
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  const MAX_CARDS = 5000;
  const MAX_STRING_LENGTH = 5000;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ---- SM-2 Quality Grades ----
  const QUALITY_FORGOT = 0;
  const QUALITY_UNSURE = 3;
  const QUALITY_KNEW = 5;

  // ---- State ----
  let allQuestions = [];
  let sessionDeck = [];
  let currentIndex = 0;
  let sm2Data = Object.create(null);
  let sessionStats = { knew: 0, unsure: 0, forgot: 0 };
  let selectedCategories = new Set();
  let allCategories = [];
  let studyDays = [];

  // ---- DOM Elements ----
  /** @param {string} id @returns {HTMLElement} */
  const $ = (id) => document.getElementById(id);

  const screens = {
    home: $('home-screen'),
    card: $('card-screen'),
    results: $('results-screen'),
  };

  const domElements = {
    totalCount: $('total-count'),
    learnedCount: $('learned-count'),
    remainingCount: $('remaining-count'),
    overallProgress: $('overall-progress'),
    progressText: $('progress-text'),
    startBtn: $('start-btn'),
    loadBtn: $('load-btn'),
    fileInput: $('file-input'),
    exportBtn: $('export-btn'),
    themeBtn: $('theme-btn'),
    resetBtn: $('reset-btn'),
    categoryChips: $('category-chips'),
    categoryHeader: $('category-header'),
    backBtn: $('back-btn'),
    cardCounter: $('card-counter'),
    sessionProgress: $('session-progress'),
    flashcard: $('flashcard'),
    questionText: $('question-text'),
    answerText: $('answer-text'),
    cardActions: $('card-actions'),
    forgotBtn: $('forgot-btn'),
    unsureBtn: $('unsure-btn'),
    knewBtn: $('knew-btn'),
    resultsCorrect: $('results-correct'),
    resultsUnsure: $('results-unsure'),
    resultsRepeat: $('results-repeat'),
    resultsTitle: $('results-title'),
    continueBtn: $('continue-btn'),
    homeBtn: $('home-btn'),
    overlay: $('overlay'),
    dialogText: $('dialog-text'),
    dialogActions: $('dialog-actions'),
    studyDaysCount: $('study-days-count'),
    allDoneInfo: $('all-done-info'),
    ssKnew: $('ss-knew'),
    ssUnsure: $('ss-unsure'),
    ssForgot: $('ss-forgot'),
    menuBtn: $('menu-btn'),
    drawer: $('drawer'),
    drawerOverlay: $('drawer-overlay'),
  };

  // ---- Navigation ----

  /** Switch visible screen by name ('home' | 'card' | 'results'). */
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ---- Drawer ----

  /** Open the side navigation drawer. */
  function openDrawer() {
    domElements.drawerOverlay.hidden = false;
    requestAnimationFrame(function () {
      domElements.drawerOverlay.classList.add('visible');
      domElements.drawer.classList.add('open');
    });
  }

  /** Close the side navigation drawer. */
  function closeDrawer() {
    domElements.drawerOverlay.classList.remove('visible');
    domElements.drawer.classList.remove('open');
    setTimeout(function () {
      domElements.drawerOverlay.hidden = true;
    }, 300);
  }

  // ---- Safe Storage ----

  /** Write to localStorage with quota error handling. */
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      alert('Не удалось сохранить данные. Хранилище переполнено.');
    }
  }

  // ---- Validation ----

  /**
   * Validate a single question object from imported JSON.
   * @param {*} q - Object to validate.
   * @returns {boolean} True if valid.
   */
  function validateQuestion(q) {
    if (!q || typeof q !== 'object') return false;
    if (q.id !== undefined && typeof q.id !== 'number' && typeof q.id !== 'string') return false;
    if (typeof q.question !== 'string' || q.question.length === 0 || q.question.length > MAX_STRING_LENGTH) return false;
    if (typeof q.answer !== 'string' || q.answer.length === 0 || q.answer.length > MAX_STRING_LENGTH) return false;
    if (q.category !== undefined && (typeof q.category !== 'string' || q.category.length > 100)) return false;
    return true;
  }

  /** Generate a stable ID from question text (DJB2 hash). */
  function generateCardId(question) {
    var hash = 5381;
    for (var i = 0; i < question.length; i++) {
      hash = ((hash << 5) + hash + question.charCodeAt(i)) & 0xffffffff;
    }
    return 'a' + (hash >>> 0).toString(36);
  }

  /** Assign auto-generated IDs to cards that don't have one. */
  function assignCardIds(cards) {
    cards.forEach(function (card) {
      if (card.id === undefined || card.id === null) {
        card.id = generateCardId(card.question);
      }
    });
  }

  /**
   * Validate a single SM-2 data entry from imported backup.
   * @param {*} entry - Object to validate.
   * @returns {boolean} True if valid.
   */
  function validateSM2Entry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.easeFactor !== 'number' || entry.easeFactor < 1.3) return false;
    if (!Number.isInteger(entry.interval) || entry.interval < 0) return false;
    if (!Number.isInteger(entry.repetitions) || entry.repetitions < 0) return false;
    if (typeof entry.nextReview !== 'string' || !ISO_DATE_RE.test(entry.nextReview)) return false;
    return true;
  }

  // ---- Study Days ----

  /** Load unique study day dates from localStorage. */
  function loadStudyDays() {
    var saved = localStorage.getItem(STORAGE_STUDY_DAYS);
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        studyDays = Array.isArray(parsed)
          ? parsed.filter(function (d) { return typeof d === 'string' && ISO_DATE_RE.test(d); })
          : [];
      } catch (e) { studyDays = []; }
    }
  }

  /** Persist study days array to localStorage. */
  function saveStudyDays() {
    safeSetItem(STORAGE_STUDY_DAYS, JSON.stringify(studyDays));
  }

  /** Record today's date as a study day (if not already tracked). */
  function trackStudyDay() {
    var today = new Date().toISOString().split('T')[0];
    if (studyDays.indexOf(today) === -1) {
      studyDays.push(today);
      saveStudyDays();
    }
    updateStudyDaysDisplay();
  }

  /** Update the study days counter in the app bar. */
  function updateStudyDaysDisplay() {
    if (domElements.studyDaysCount) {
      domElements.studyDaysCount.textContent = studyDays.length;
    }
  }

  // ---- Theme ----

  /** Load theme from localStorage or system preference, apply to <html>. */
  function loadTheme() {
    var saved = localStorage.getItem(STORAGE_THEME);
    var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  }

  /** Apply theme and update toggle button label. */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (domElements.themeBtn) {
      domElements.themeBtn.textContent = theme === 'dark' ? '\u2600\uFE0F Светлая тема' : '\uD83C\uDF19 Тёмная тема';
    }
  }

  /** Toggle between light and dark themes. */
  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    safeSetItem(STORAGE_THEME, next);
  }

  // ---- SM-2 Algorithm ----

  /** Return default SM-2 data for a new/unseen card (due today). */
  function defaultSM2() {
    return {
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReview: new Date().toISOString().split('T')[0],
    };
  }

  /** Get SM-2 data for a card, returning defaults if none exists. */
  function getCardSM2(cardId) {
    return sm2Data[String(cardId)] || defaultSM2();
  }

  /**
   * Calculate updated SM-2 parameters after an answer.
   * @param {Object} cardData - Current SM-2 state {easeFactor, interval, repetitions}.
   * @param {number} quality - Answer quality: 0=forgot, 3=unsure, 5=knew.
   * @returns {Object} Updated SM-2 state with new nextReview date.
   */
  function calculateSM2(cardData, quality) {
    let { easeFactor, interval, repetitions } = cardData;

    if (quality >= QUALITY_UNSURE) {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions++;
    } else {
      repetitions = 0;
      interval = 1;
    }

    // SM-2 ease factor formula: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    easeFactor = easeFactor + (0.1 - (QUALITY_KNEW - quality) * (0.08 + (QUALITY_KNEW - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    const today = new Date();
    today.setDate(today.getDate() + interval);
    const nextReview = today.toISOString().split('T')[0];

    return { easeFactor, interval, repetitions, nextReview };
  }

  // ---- Data Loading ----

  /** Load questions from localStorage (custom) or fetch questions.json (default). */
  async function loadQuestions() {
    const custom = localStorage.getItem(STORAGE_CUSTOM_QUESTIONS);
    if (custom) {
      try {
        allQuestions = JSON.parse(custom);
        assignCardIds(allQuestions);
        return;
      } catch (e) {
        console.warn('Failed to parse custom questions, loading defaults');
      }
    }

    try {
      const response = await fetch('questions.json');
      const data = await response.json();
      allQuestions = Array.isArray(data) ? data.filter(validateQuestion) : [];
      assignCardIds(allQuestions);
    } catch (e) {
      console.warn('Failed to load questions.json, using empty set');
      allQuestions = [];
    }
  }

  /** Load SM-2 progress from localStorage, migrating legacy learnedIds if needed. */
  function loadProgress() {
    const sm2Saved = localStorage.getItem(STORAGE_SM2);
    if (sm2Saved) {
      try {
        sm2Data = Object.assign(Object.create(null), JSON.parse(sm2Saved));
        return;
      } catch (e) {
        sm2Data = Object.create(null);
      }
    }

    // Migration from old learnedIds format
    const oldLearned = localStorage.getItem(STORAGE_LEARNED);
    if (oldLearned) {
      try {
        const ids = JSON.parse(oldLearned);
        ids.forEach(function (id) {
          const future = new Date();
          future.setDate(future.getDate() + 30);
          sm2Data[String(id)] = {
            easeFactor: 2.5,
            interval: 30,
            repetitions: 3,
            nextReview: future.toISOString().split('T')[0],
          };
        });
        saveSM2();
        localStorage.removeItem(STORAGE_LEARNED);
      } catch (e) {
        // ignore migration errors
      }
    }
  }

  /** Persist SM-2 data to localStorage. */
  function saveSM2() {
    safeSetItem(STORAGE_SM2, JSON.stringify(sm2Data));
  }

  // ---- Categories ----

  /** Extract unique sorted categories from allQuestions. */
  function extractCategories() {
    const cats = new Set();
    allQuestions.forEach(function (q) {
      if (q.category) cats.add(q.category);
    });
    allCategories = [...cats].sort();
  }

  /** Load selected category filter from localStorage. Defaults to all categories. */
  function loadCategoryFilter() {
    const saved = localStorage.getItem(STORAGE_CATEGORIES);
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        selectedCategories = new Set(arr.filter(function (c) {
          return allCategories.includes(c);
        }));
      } catch (e) {
        selectedCategories = new Set();
      }
    }
    if (selectedCategories.size === 0) {
      selectedCategories = new Set(allCategories);
    }
  }

  /** Persist selected categories to localStorage. */
  function saveCategoryFilter() {
    safeSetItem(STORAGE_CATEGORIES, JSON.stringify([...selectedCategories]));
  }

  /** Render category filter chips on the home screen. Hides if <=1 category. */
  function renderCategoryChips() {
    const container = domElements.categoryChips;
    container.replaceChildren();

    if (allCategories.length <= 1) {
      container.style.display = 'none';
      if (domElements.categoryHeader) domElements.categoryHeader.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    if (domElements.categoryHeader) domElements.categoryHeader.style.display = '';

    allCategories.forEach(function (cat) {
      const chip = document.createElement('button');
      chip.className = 'chip' + (selectedCategories.has(cat) ? ' chip-active' : '');
      chip.textContent = cat;
      chip.addEventListener('click', function () {
        toggleCategory(cat);
      });
      container.appendChild(chip);
    });
  }

  /** Toggle a category on/off (at least one must remain selected). */
  function toggleCategory(cat) {
    if (selectedCategories.has(cat)) {
      if (selectedCategories.size <= 1) return;
      selectedCategories.delete(cat);
    } else {
      selectedCategories.add(cat);
    }
    saveCategoryFilter();
    renderCategoryChips();
    updateHomeStats();
  }

  /** Return questions filtered by selected categories. */
  function getFilteredQuestions() {
    if (selectedCategories.size === 0 || selectedCategories.size === allCategories.length) {
      return allQuestions;
    }
    return allQuestions.filter(function (q) {
      return selectedCategories.has(q.category);
    });
  }

  // ---- Due Cards ----

  /** Return filtered cards that are due for review (includes never-answered cards). */
  function getDueCards() {
    const today = new Date().toISOString().split('T')[0];
    return getFilteredQuestions().filter(function (q) {
      var data = getCardSM2(q.id);
      // Cards never successfully answered (repetitions=0) are always due
      return data.repetitions === 0 || data.nextReview <= today;
    });
  }

  // ---- Home Screen ----

  /** Update dashboard stats: total, reviewed, due counts, progress bar, and start button. */
  function updateHomeStats() {
    const filtered = getFilteredQuestions();
    const total = filtered.length;
    const today = new Date().toISOString().split('T')[0];
    const dueCount = filtered.filter(function (q) {
      var d = getCardSM2(q.id);
      return d.repetitions === 0 || d.nextReview <= today;
    }).length;
    const reviewedCount = filtered.filter(function (q) {
      var d = sm2Data[String(q.id)];
      return d && d.repetitions > 0;
    }).length;
    const percent = total > 0 ? Math.round((reviewedCount / total) * 100) : 0;

    domElements.totalCount.textContent = total;
    domElements.learnedCount.textContent = reviewedCount;
    domElements.remainingCount.textContent = dueCount;
    domElements.overallProgress.style.width = percent + '%';
    domElements.progressText.textContent = percent + '%';

    domElements.startBtn.disabled = total === 0;
    var allDone = dueCount === 0 && total > 0;
    if (allDone) {
      domElements.startBtn.textContent = '🔄 Повторить всё (' + total + ')';
    } else {
      domElements.startBtn.textContent = '▶ Начать (' + dueCount + ')';
    }
    if (domElements.allDoneInfo) {
      domElements.allDoneInfo.hidden = !allDone;
    }
  }

  // ---- Session ----

  /** Fisher-Yates shuffle. Returns a new shuffled array. */
  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Update session stats badges (knew/unsure/forgot) on the card screen. */
  function updateSessionStatsDisplay() {
    domElements.ssKnew.textContent = sessionStats.knew;
    domElements.ssUnsure.textContent = sessionStats.unsure;
    domElements.ssForgot.textContent = sessionStats.forgot;
  }

  /** Start a new study session with due cards (or all cards if none due). */
  function startSession() {
    const due = getDueCards();
    const cards = due.length > 0 ? due : getFilteredQuestions();
    if (cards.length === 0) return;

    sessionDeck = shuffle(cards);
    currentIndex = 0;
    sessionStats = { knew: 0, unsure: 0, forgot: 0 };
    updateSessionStatsDisplay();

    showScreen('card');
    showCard();
  }

  /**
   * Render text with markdown-style code formatting into a container.
   * Uses DOM methods (no innerHTML) to preserve XSS safety.
   * Supports ```code blocks``` and `inline code`.
   */
  function renderFormattedText(container, text) {
    container.replaceChildren();
    // Normalize double-escaped newlines from AI-generated cards (\\n → \n)
    text = text.replace(/\\n/g, '\n');
    // Split by ``` for code blocks (odd segments = code)
    var blockParts = text.split('```');
    for (var b = 0; b < blockParts.length; b++) {
      if (b % 2 === 1) {
        // Code block — strip optional language hint on first line
        var code = blockParts[b];
        var newline = code.indexOf('\n');
        if (newline !== -1 && newline < 20 && /^\w*$/.test(code.substring(0, newline))) {
          code = code.substring(newline + 1);
        }
        var pre = document.createElement('pre');
        pre.className = 'code-block';
        var codeEl = document.createElement('code');
        codeEl.textContent = code;
        pre.appendChild(codeEl);
        container.appendChild(pre);
      } else {
        // Plain text — split by ` for inline code
        var inlineParts = blockParts[b].split('`');
        for (var i = 0; i < inlineParts.length; i++) {
          if (i % 2 === 1) {
            var inlineCode = document.createElement('code');
            inlineCode.className = 'code-inline';
            inlineCode.textContent = inlineParts[i];
            container.appendChild(inlineCode);
          } else if (inlineParts[i]) {
            // Split by ** for bold text (odd segments = bold)
            var boldParts = inlineParts[i].split('**');
            for (var bp = 0; bp < boldParts.length; bp++) {
              if (bp % 2 === 1) {
                var strong = document.createElement('strong');
                strong.className = 'text-bold';
                strong.textContent = boldParts[bp];
                container.appendChild(strong);
              } else if (boldParts[bp]) {
                var lines = boldParts[bp].split('\n');
                for (var l = 0; l < lines.length; l++) {
                  if (l > 0) container.appendChild(document.createElement('br'));
                  if (lines[l]) container.appendChild(document.createTextNode(lines[l]));
                }
              }
            }
          }
        }
      }
    }
  }

  /** Display the current card (or show results if deck is finished). */
  function showCard() {
    if (currentIndex >= sessionDeck.length) {
      showResults();
      return;
    }

    const card = sessionDeck[currentIndex];
    renderFormattedText(domElements.questionText, card.question);
    renderFormattedText(domElements.answerText, card.answer);

    domElements.flashcard.classList.remove('flipped');
    domElements.cardActions.classList.remove('visible');
    domElements.questionText.scrollTop = 0;
    domElements.answerText.scrollTop = 0;

    const totalInSession = sessionDeck.length;
    domElements.cardCounter.textContent = (currentIndex + 1) + ' / ' + totalInSession;
    const progress = (currentIndex / totalInSession) * 100;
    domElements.sessionProgress.style.width = progress + '%';
  }

  /** Toggle the card between question and answer sides. */
  function flipCard() {
    domElements.flashcard.classList.toggle('flipped');

    if (domElements.flashcard.classList.contains('flipped')) {
      domElements.cardActions.classList.add('visible');
    } else {
      domElements.cardActions.classList.remove('visible');
    }
  }

  /**
   * Process user's answer: update SM-2, track stats, advance deck.
   * Forgot cards are re-inserted later in the deck for retry.
   * @param {number} quality - 0=forgot, 3=unsure, 5=knew.
   */
  function processAnswer(quality) {
    const card = sessionDeck[currentIndex];
    const cardId = String(card.id);
    const current = getCardSM2(card.id);
    const updated = calculateSM2(current, quality);
    sm2Data[cardId] = updated;
    saveSM2();
    trackStudyDay();

    if (quality >= QUALITY_UNSURE) {
      if (quality === QUALITY_KNEW) sessionStats.knew++;
      else sessionStats.unsure++;
      currentIndex++;
    } else {
      sessionStats.forgot++;
      const remaining = sessionDeck.length - currentIndex - 1;
      if (remaining > 0) {
        sessionDeck.splice(currentIndex, 1);
        const insertAt = currentIndex + Math.floor(Math.random() * remaining) + 1;
        const safeInsert = Math.min(insertAt, sessionDeck.length);
        sessionDeck.splice(safeInsert, 0, card);
      } else {
        // Last card forgotten — re-append for another attempt
        sessionDeck.push(card);
        currentIndex++;
      }
    }

    updateSessionStatsDisplay();
    showCard();
  }

  /** Mark current card as "knew" (quality 5). */
  function markKnew() { processAnswer(QUALITY_KNEW); }
  /** Mark current card as "unsure" (quality 3). */
  function markUnsure() { processAnswer(QUALITY_UNSURE); }
  /** Mark current card as "forgot" (quality 0). */
  function markForgot() { processAnswer(QUALITY_FORGOT); }

  // ---- Results ----

  /** Display session results screen with stats and optional continue button. */
  function showResults() {
    domElements.resultsCorrect.textContent = sessionStats.knew;
    domElements.resultsUnsure.textContent = sessionStats.unsure;
    domElements.resultsRepeat.textContent = sessionStats.forgot;

    if (sessionStats.forgot === 0 && sessionStats.unsure === 0) {
      domElements.resultsTitle.textContent = 'Идеальная сессия!';
    } else {
      domElements.resultsTitle.textContent = 'Сессия завершена!';
    }

    domElements.sessionProgress.style.width = '100%';

    const dueCount = getDueCards().length;
    domElements.continueBtn.style.display = dueCount > 0 ? 'flex' : 'none';

    showScreen('results');
  }

  // ---- Dialog System ----

  /**
   * Show a modal dialog with custom buttons. Returns a Promise resolving to the clicked button's value.
   * @param {string} text - Dialog message.
   * @param {Array<{label: string, value: string, className: string}>} buttons - Button configs.
   * @returns {Promise<string>} The value of the clicked button.
   */
  function showDialogEx(text, buttons) {
    return new Promise(function (resolve) {
      domElements.dialogText.textContent = text;
      var actionsContainer = domElements.dialogActions;
      actionsContainer.replaceChildren();

      buttons.forEach(function (btn) {
        var button = document.createElement('button');
        button.className = 'btn ' + btn.className;
        button.textContent = btn.label;
        button.addEventListener('click', function () {
          domElements.overlay.hidden = true;
          resolve(btn.value);
        });
        actionsContainer.appendChild(button);
      });

      domElements.overlay.hidden = false;
    });
  }

  /** Show a confirm/cancel dialog. Returns Promise<boolean>. */
  function showDialog(text) {
    return showDialogEx(text, [
      { label: 'Отмена', value: 'cancel', className: 'btn-text' },
      { label: 'Подтвердить', value: 'confirm', className: 'btn-primary' },
    ]).then(function (v) { return v === 'confirm'; });
  }

  // ---- File Loading ----

  /**
   * Handle JSON file upload: validate size and format, detect backup vs questions array,
   * offer replace/add options, update state accordingly.
   */
  async function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    // Guard: file size
    if (file.size > MAX_FILE_SIZE) {
      alert('Файл слишком большой. Максимум 5 МБ.');
      return;
    }

    var text;
    try {
      text = await file.text();
    } catch (e) {
      alert('Не удалось прочитать файл.');
      return;
    }

    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      alert('Некорректный JSON файл.');
      return;
    }

    // Detect backup format
    if (data && typeof data === 'object' && !Array.isArray(data) && data.version) {
      await handleImportBackup(data);
      return;
    }

    // Plain questions array
    if (!Array.isArray(data) || data.length === 0) {
      alert('Некорректный файл: ожидается JSON массив карточек.');
      return;
    }

    // Guard: array length
    if (data.length > MAX_CARDS) {
      alert('Слишком много карточек. Максимум ' + MAX_CARDS + '.');
      return;
    }

    // Validate each question
    const invalidIndex = data.findIndex(function (q) { return !validateQuestion(q); });
    if (invalidIndex !== -1) {
      alert('Ошибка в карточке #' + (invalidIndex + 1) + ': каждая карточка должна иметь поля "question" (строка) и "answer" (строка).');
      return;
    }

    // 3-option dialog: Replace / Add / Cancel
    const action = await showDialogEx(
      'Как загрузить ' + data.length + ' карточек?',
      [
        { label: 'Заменить', value: 'replace', className: 'btn-primary' },
        { label: 'Добавить к существующим', value: 'add', className: 'btn-outlined' },
        { label: 'Отмена', value: 'cancel', className: 'btn-text' },
      ]
    );

    if (action === 'replace') {
      assignCardIds(data);
      allQuestions = data;
      safeSetItem(STORAGE_CUSTOM_QUESTIONS, JSON.stringify(data));
      sm2Data = Object.create(null);
      saveSM2();
    } else if (action === 'add') {
      assignCardIds(data);
      const existingIds = new Set(allQuestions.map(function (q) { return q.id; }));
      const newCards = data.filter(function (q) { return !existingIds.has(q.id); });
      if (newCards.length === 0) {
        alert('Нет новых карточек — все уже загружены.');
        return;
      }
      allQuestions = [...allQuestions, ...newCards];
      safeSetItem(STORAGE_CUSTOM_QUESTIONS, JSON.stringify(allQuestions));
    } else {
      return; // cancel
    }

    extractCategories();
    loadCategoryFilter();
    renderCategoryChips();
    updateHomeStats();
  }

  // ---- Export / Import ----

  /** Export all data (questions, SM-2 progress, categories, study days) as a JSON backup file. */
  function exportBackup() {
    const backup = {
      version: 1,
      exportDate: new Date().toISOString(),
      questions: allQuestions,
      progress: {
        sm2Data: sm2Data,
        selectedCategories: [...selectedCategories],
        studyDays: studyDays,
      },
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prepdeck-backup-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Import a backup file: validate all data, confirm with user, restore. */
  async function handleImportBackup(data) {
    if (data.version !== 1) {
      alert('Неподдерживаемая версия бэкапа.');
      return;
    }

    if (!data.questions || !Array.isArray(data.questions)) {
      alert('Некорректный бэкап: отсутствует массив карточек.');
      return;
    }

    if (data.questions.length > MAX_CARDS) {
      alert('Слишком много карточек в бэкапе. Максимум ' + MAX_CARDS + '.');
      return;
    }

    // Validate questions
    var validQuestions = data.questions.filter(validateQuestion);
    if (validQuestions.length === 0) {
      alert('Бэкап не содержит корректных карточек.');
      return;
    }

    var dateStr = data.exportDate
      ? new Date(data.exportDate).toLocaleDateString()
      : 'неизвестная дата';

    var confirmed = await showDialog(
      'Восстановить бэкап от ' + dateStr + '? ' +
      validQuestions.length + ' карточек и данные прогресса. ' +
      'Текущие данные будут заменены.'
    );

    if (!confirmed) return;

    assignCardIds(validQuestions);
    allQuestions = validQuestions;
    safeSetItem(STORAGE_CUSTOM_QUESTIONS, JSON.stringify(allQuestions));

    // Validate and import SM-2 data
    sm2Data = Object.create(null);
    if (data.progress && data.progress.sm2Data && typeof data.progress.sm2Data === 'object') {
      var rawSm2 = data.progress.sm2Data;
      Object.keys(rawSm2).forEach(function (key) {
        if (validateSM2Entry(rawSm2[key])) {
          sm2Data[key] = rawSm2[key];
        }
      });
    }
    saveSM2();

    extractCategories();
    if (data.progress && Array.isArray(data.progress.selectedCategories)) {
      selectedCategories = new Set(
        data.progress.selectedCategories.filter(function (c) {
          return typeof c === 'string' && allCategories.includes(c);
        })
      );
      if (selectedCategories.size === 0) selectedCategories = new Set(allCategories);
    } else {
      selectedCategories = new Set(allCategories);
    }
    saveCategoryFilter();

    // Validate and import study days
    if (data.progress && Array.isArray(data.progress.studyDays)) {
      studyDays = data.progress.studyDays.filter(function (d) {
        return typeof d === 'string' && ISO_DATE_RE.test(d);
      });
    } else {
      studyDays = [];
    }
    saveStudyDays();
    updateStudyDaysDisplay();

    renderCategoryChips();
    updateHomeStats();
  }

  // ---- Event Listeners ----

  /** Bind all UI event listeners (buttons, drawer, card interactions). */
  function bindEvents() {
    // Drawer
    domElements.menuBtn.addEventListener('click', openDrawer);
    domElements.drawerOverlay.addEventListener('click', closeDrawer);

    // Home screen
    domElements.startBtn.addEventListener('click', startSession);
    // Drawer items
    domElements.loadBtn.addEventListener('click', function () {
      closeDrawer();
      domElements.fileInput.click();
    });
    domElements.fileInput.addEventListener('change', handleFileLoad);
    domElements.exportBtn.addEventListener('click', function () {
      closeDrawer();
      exportBackup();
    });

    domElements.themeBtn.addEventListener('click', function () {
      toggleTheme();
    });

    domElements.resetBtn.addEventListener('click', async function () {
      closeDrawer();
      var confirmed = await showDialog(
        'Сбросить весь прогресс? Это действие нельзя отменить.'
      );
      if (confirmed) {
        sm2Data = Object.create(null);
        saveSM2();
        studyDays = [];
        saveStudyDays();
        localStorage.removeItem(STORAGE_LEARNED);
        updateHomeStats();
        updateStudyDaysDisplay();
      }
    });

    // Card screen
    (function () {
      var startX = 0, startY = 0;
      domElements.flashcard.addEventListener('pointerdown', function (e) {
        startX = e.clientX;
        startY = e.clientY;
      });
      domElements.flashcard.addEventListener('pointerup', function (e) {
        var dx = Math.abs(e.clientX - startX);
        var dy = Math.abs(e.clientY - startY);
        if (dx < 10 && dy < 10) flipCard();
      });
    })();
    domElements.forgotBtn.addEventListener('click', markForgot);
    domElements.unsureBtn.addEventListener('click', markUnsure);
    domElements.knewBtn.addEventListener('click', markKnew);

    domElements.backBtn.addEventListener('click', function () {
      updateHomeStats();
      showScreen('home');
    });

    // Results screen
    domElements.continueBtn.addEventListener('click', startSession);
    domElements.homeBtn.addEventListener('click', function () {
      updateHomeStats();
      showScreen('home');
    });
  }

  // ---- Init ----

  /** Initialize app: load data, render UI, bind events. */
  async function init() {
    loadTheme();
    await loadQuestions();
    extractCategories();
    loadCategoryFilter();
    loadProgress();
    loadStudyDays();
    renderCategoryChips();
    updateHomeStats();
    updateStudyDaysDisplay();
    bindEvents();
  }

  // ---- Register Service Worker ----

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  init();
})();
