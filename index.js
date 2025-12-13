/* 核心逻辑：表格 + 搜索/分页 + 标记 + 超级转盘 + 朗读(单词&例句) */
(() => {
  "use strict";

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    processedData: [],
    filteredData: [],
    marked: new Set(JSON.parse(localStorage.getItem("vocab_marked") || "[]")),
    currentPage: 1,
    itemsPerPage: 20,

    // speech
    voices: [],
    speech: {
      voiceURI: localStorage.getItem("speech_voiceURI") || "",
      accent: localStorage.getItem("speech_accent") || "en-US",
      rate: parseFloat(localStorage.getItem("speech_rate") || "0.92"),
      pitch: parseFloat(localStorage.getItem("speech_pitch") || "1.0"),
      volume: 1.0,
    },
    speechUnlocked: false,

    // wheel
    wheelData: [],
    wheelEliminated: new Set(),
    wheelMode: "en_cn",
    isSpinning: false,
    currentCardIndex: -1,
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function sanitize(s) {
    return (s ?? "").toString();
  }

  // -----------------------------
  // Speech: make it sound "more natural"
  // - pick a better voice when available (Google/Microsoft/Samantha/etc.)
  // - tune rate/pitch slightly
  // - keep it user-customizable
  // -----------------------------
  function scoreVoice(v, accent) {
    const name = (v.name || "").toLowerCase();
    const lang = (v.lang || "").toLowerCase();
    const want = accent.toLowerCase();

    let score = 0;
    if (lang.startsWith(want.toLowerCase())) score += 50;
    if (v.localService) score += 2;

    // Prefer higher quality voices when present
    const prefer = [
      "google",
      "microsoft",
      "siri",
      "samantha",
      "karen",
      "tessa",
      "daniel",
      "alex",
      "neural",
      "online",
      "premium",
      "enhanced",
    ];
    for (const p of prefer) {
      if (name.includes(p)) score += 10;
    }
    // Penalize obviously robotic/low quality
    const avoid = ["compact", "espeak", "festival", "mbrola"];
    for (const a of avoid) {
      if (name.includes(a)) score -= 30;
    }
    return score;
  }

  function getVoicesSafe() {
    if (!("speechSynthesis" in window)) return [];
    const voices = window.speechSynthesis.getVoices() || [];
    return voices;
  }

  function refreshVoices() {
    state.voices = getVoicesSafe();
    renderVoiceSelect();
  }

  function renderVoiceSelect() {
    const sel = $("#voiceSelect");
    if (!sel) return;

    const accent = state.speech.accent;
    const voices = state.voices
      .filter((v) =>
        (v.lang || "")
          .toLowerCase()
          .startsWith(accent.toLowerCase().slice(0, 2))
      )
      .sort((a, b) => scoreVoice(b, accent) - scoreVoice(a, accent));

    // Keep previous selection if still exists
    sel.innerHTML = "";
    const optAuto = document.createElement("option");
    optAuto.value = "";
    optAuto.textContent = "自动选择（推荐）";
    sel.appendChild(optAuto);

    for (const v of voices) {
      const o = document.createElement("option");
      o.value = v.voiceURI || v.name;
      o.textContent = `${v.name} (${v.lang})${v.localService ? "" : " · 在线"}`;
      sel.appendChild(o);
    }
    sel.value = state.speech.voiceURI || "";
  }

  function pickBestVoice(accent) {
    const voices = state.voices;
    if (!voices.length) return null;

    // If user selected a specific one, try it first
    if (state.speech.voiceURI) {
      const exact = voices.find(
        (v) =>
          v.voiceURI === state.speech.voiceURI ||
          v.name === state.speech.voiceURI
      );
      if (exact) return exact;
    }

    // Otherwise auto-pick best-scored
    let best = null;
    let bestScore = -1e9;
    for (const v of voices) {
      const s = scoreVoice(v, accent);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    return best;
  }

  function unlockSpeechOnce() {
    if (state.speechUnlocked) return;
    if (!("speechSynthesis" in window)) return;

    // Some mobile browsers need a user gesture first; we do a silent-ish utterance.
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
      state.speechUnlocked = true;
    } catch (_) {}
  }

  function speakText(text, accentOverride) {
    if (!("speechSynthesis" in window)) {
      toast("当前浏览器不支持语音朗读");
      return;
    }
    unlockSpeechOnce();

    const textClean = sanitize(text).trim();
    if (!textClean) return;

    // cancel ongoing
    window.speechSynthesis.cancel();

    const accent = accentOverride || state.speech.accent;
    const u = new SpeechSynthesisUtterance(textClean);
    u.lang = accent;
    u.rate = clamp(state.speech.rate, 0.6, 1.25);
    u.pitch = clamp(state.speech.pitch, 0.7, 1.2);
    u.volume = clamp(state.speech.volume, 0, 1);

    const v = pickBestVoice(accent);
    if (v) u.voice = v;

    window.speechSynthesis.speak(u);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // -----------------------------
  // Data processing
  // -----------------------------
  function processData() {
    const map = new Map();
    (window.WORDS || []).forEach((item) => {
      if (!item || !item.word) return;
      map.set(item.word.toLowerCase().trim(), item);
    });
    state.processedData = Array.from(map.values());
  }

  // -----------------------------
  // Filters + render
  // -----------------------------
  function applyFilters() {
    const search = $("#searchInput").value.toLowerCase().trim();
    const hideMarked = $("#hideMarkedCheckbox").checked;

    state.filteredData = state.processedData.filter((item) => {
      const key = (item.word || "").toLowerCase();
      if (hideMarked && state.marked.has(key)) return false;
      if (search) {
        const meaning = (item.meaning || "").toLowerCase();
        const sentence = (item.sentence || "").toLowerCase();
        if (
          !key.includes(search) &&
          !meaning.includes(search) &&
          !sentence.includes(search)
        )
          return false;
      }
      return true;
    });

    renderTable();
    updatePagination();
    updateStats();
  }

  function updateStats() {
    const total = state.processedData.length;
    const mastered = state.marked.size;
    const left = Math.max(0, total - mastered);
    $("#statTotal").textContent = total.toString();
    $("#statMastered").textContent = mastered.toString();
    $("#statLeft").textContent = left.toString();
  }

  function renderTable() {
    const tbody = $("#tableBody");
    tbody.innerHTML = "";

    const start = (state.currentPage - 1) * state.itemsPerPage;
    const pageData = state.filteredData.slice(
      start,
      start + state.itemsPerPage
    );

    if (!pageData.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:22px;color:#9CA3AF;text-align:center;">无数据</td></tr>`;
      return;
    }

    for (const item of pageData) {
      const key = (item.word || "").toLowerCase();
      const isMarked = state.marked.has(key);

      const tr = document.createElement("tr");
      if (isMarked) tr.classList.add("marked");

      const wordHtml = `
        <div class="word">
          <strong>${escapeHtml(item.word)}</strong>
          <button class="icon-btn" title="朗读单词" aria-label="朗读单词" data-speak-word="${escapeAttr(
            item.word
          )}">
            ${speakerSvg()}
          </button>
          <span class="phonetic">${escapeHtml(item.phonetic || "")}</span>
        </div>
      `;

      const exampleHtml = `
        <div class="example-line">
          <button class="icon-btn" title="朗读例句" aria-label="朗读例句" data-speak-sentence="${escapeAttr(
            item.sentence || ""
          )}">
            ${speakerSvg()}
          </button>
          <div class="text">
            <div class="example">${escapeHtml(item.sentence || "")}</div>
            <div class="translation">${escapeHtml(item.translation || "")}</div>
          </div>
        </div>
      `;

      tr.innerHTML = `
        <td>
  <button class="check ${
    isMarked ? "active" : ""
  }" title="标记已掌握" data-toggle-mark="${escapeAttr(item.word)}">✓</button>
</td>
        <td>${wordHtml}</td>
        <td><span class="badge">${escapeHtml(item.pos || "")}</span></td>
        <td class="meaning">${escapeHtml(item.meaning || "")}</td>
        <td>${exampleHtml}</td>
      `;
      tbody.appendChild(tr);
    }

    // attach events with delegation
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = sanitize(s);
    return div.innerHTML;
  }
  function escapeAttr(s) {
    return sanitize(s).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function speakerSvg(gray = false) {
    return `
      <svg class="spk ${
        gray ? "gray" : ""
      }" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10v4a2 2 0 0 0 2 2h3l4 3a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 12 5l-4 3H5a2 2 0 0 0-2 2Zm14.5 2a4.5 4.5 0 0 0-2.2-3.9 1 1 0 1 0-1 1.7 2.5 2.5 0 0 1 0 4.4 1 1 0 1 0 1 1.7A4.5 4.5 0 0 0 17.5 12Zm2.7 0a7.2 7.2 0 0 0-3.6-6.2 1 1 0 0 0-1 1.7 5.2 5.2 0 0 1 0 9 1 1 0 1 0 1 1.7 7.2 7.2 0 0 0 3.6-6.2Z"/>
      </svg>
    `;
  }

  // -----------------------------
  // Pagination
  // -----------------------------
  function updatePagination() {
    const max = Math.ceil(state.filteredData.length / state.itemsPerPage) || 1;
    $("#pageInfo").textContent = `Page ${state.currentPage} of ${max}`;
    $("#prevBtn").disabled = state.currentPage === 1;
    $("#nextBtn").disabled = state.currentPage === max;
  }

  function changePage(delta) {
    const max = Math.ceil(state.filteredData.length / state.itemsPerPage) || 1;
    state.currentPage = clamp(state.currentPage + delta, 1, max);
    renderTable();
    updatePagination();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // -----------------------------
  // Marking
  // -----------------------------
  function toggleMark(word) {
    const key = sanitize(word).toLowerCase();
    if (!key) return;
    if (state.marked.has(key)) state.marked.delete(key);
    else state.marked.add(key);

    localStorage.setItem(
      "vocab_marked",
      JSON.stringify(Array.from(state.marked))
    );
    applyFilters();
  }

  // -----------------------------
  // Wheel
  // -----------------------------
  function openWheel() {
    $("#wheelOverlay").style.display = "block";
    if (!state.wheelData.length) refreshWheelRandomly();
    else drawWheel();
  }
  function closeWheel() {
    $("#wheelOverlay").style.display = "none";
    $("#flashcard").classList.remove("show");
  }

  function setWheelMode(mode) {
    if (state.wheelMode === mode) return;
    state.wheelMode = mode;
    $("#modeEnCn").classList.toggle("active", mode === "en_cn");
    $("#modeCnEn").classList.toggle("active", mode === "cn_en");
    refreshWheelRandomly();
  }

  function refreshWheelRandomly() {
    state.wheelEliminated.clear();
    const pool = state.processedData.filter(
      (i) => !state.marked.has((i.word || "").toLowerCase())
    );
    if (!pool.length) {
      alert("词库为空或所有单词已掌握！");
      return;
    }
    shuffle(pool);
    state.wheelData = pool.slice(0, 50);
    updateWheelStats();
    drawWheel();
  }

  function updateWheelStats() {
    const left = state.wheelData.length - state.wheelEliminated.size;
    const modeText = state.wheelMode === "en_cn" ? "英 ➜ 中" : "中 ➜ 英";
    $(
      "#wheelStats"
    ).textContent = `[${modeText}] 本轮库: ${state.wheelData.length} 词 | 剩余活跃: ${left}`;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function drawWheel() {
    const canvas = $("#wheelCanvas");
    const ctx = canvas.getContext("2d");
    const count = state.wheelData.length;
    const width = canvas.width;
    const center = width / 2;
    const radius = width / 2 - 42;
    const arc = (2 * Math.PI) / count;

    const colors = [
      "#FFB7B2",
      "#FFDAC1",
      "#E2F0CB",
      "#B5EAD7",
      "#C7CEEA",
      "#95a5a6",
    ];

    ctx.clearRect(0, 0, width, width);
    ctx.font = "bold 24px system-ui";
    ctx.textBaseline = "middle";

    for (let i = 0; i < count; i++) {
      const angle = i * arc;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.arc(center, center, radius, angle, angle + arc);

      if (state.wheelEliminated.has(i)) ctx.fillStyle = "#263244";
      else ctx.fillStyle = colors[i % (colors.length - 1)];

      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.75)";
      ctx.lineWidth = 4;
      ctx.stroke();

      if (!state.wheelEliminated.has(i)) {
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(angle + arc / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#102A33";

        let text = "";
        if (state.wheelMode === "en_cn") text = state.wheelData[i].word;
        else text = state.wheelData[i].meaning;

        text = sanitize(text);
        if (text.length > 10) text = text.slice(0, 9) + "…";
        ctx.fillText(text, radius - 32, 0);
        ctx.restore();
      }
    }
  }

  function spinWheel() {
    if (state.isSpinning) return;
    if (state.wheelEliminated.size >= state.wheelData.length) {
      alert("本轮单词已全部完成，请点击“换一批”！");
      return;
    }

    state.isSpinning = true;
    $("#spinBtn").disabled = true;
    $("#flashcard").classList.remove("show");

    let winningIndex;
    do {
      winningIndex = Math.floor(Math.random() * state.wheelData.length);
    } while (state.wheelEliminated.has(winningIndex));

    state.currentCardIndex = winningIndex;

    const arcDegrees = 360 / state.wheelData.length;
    const targetAngle = winningIndex * arcDegrees + arcDegrees / 2;
    let rotate = 270 - targetAngle;
    while (rotate > -1000) rotate -= 360;
    rotate -= 360 * 5;
    rotate += (Math.random() - 0.5) * (arcDegrees * 0.7);

    const canvas = $("#wheelCanvas");
    canvas.style.transition = "transform 3.3s cubic-bezier(0.2, 0.8, 0.3, 1)";
    canvas.style.transform = `rotate(${rotate}deg)`;

    setTimeout(() => {
      state.isSpinning = false;
      $("#spinBtn").disabled = false;
      showFlashcard(state.wheelData[winningIndex]);
    }, 3300);
  }

  function showFlashcard(item) {
    const card = $("#flashcard");
    const qEl = $("#cardQuestion");
    const hEl = $("#cardHint");
    const aEl = $("#cardAnswer");
    $(".answer-mask").classList.remove("revealed");

    const word = sanitize(item.word);
    const sentence = sanitize(item.sentence);
    const meaning = sanitize(item.meaning);
    const pos = sanitize(item.pos);
    const phonetic = sanitize(item.phonetic);
    const translation = sanitize(item.translation);

    if (state.wheelMode === "en_cn") {
      qEl.textContent = word;
      hEl.textContent = `${pos} · 请回忆中文意思`;
      aEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:1.35rem;color:var(--primary);font-weight:950;">${escapeHtml(
            meaning
          )}</div>
        </div>
        <div style="margin:10px 0;border-top:1px dashed #CBD5E1;"></div>
        <div class="example-line" style="align-items:flex-start;">
          <div class="text">
            <div style="font-style:italic;color:#334155;">${escapeHtml(
              sentence
            )}</div>
            <div style="font-size:.9rem;color:#94A3B8;margin-top:4px;">${escapeHtml(
              translation
            )}</div>
          </div>
        </div>`;
      // 自动读单词（保持自然，不要太快）
      setTimeout(() => speakText(word, state.speech.accent), 150);
    } else {
      qEl.textContent = meaning;
      hEl.textContent = `${pos} · 请拼写英文单词`;
      aEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <div>
            <div style="font-size:1.7rem;font-weight:950;color:var(--primary);">${escapeHtml(
              word
            )}</div>
            <div style="color:#64748B;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(
              phonetic
            )}</div>
          </div>
        </div>
        <div style="margin:10px 0;border-top:1px dashed #CBD5E1;"></div>
        <div class="example-line" style="align-items:flex-start;">
          <div class="text">
            <div style="font-style:italic;color:#334155;">${escapeHtml(
              sentence
            )}</div>
          </div>
        </div>`;
    }

    card.classList.add("show");
  }

  function revealAnswer() {
    $(".answer-mask").classList.add("revealed");
    if (state.wheelMode === "cn_en") {
      const item = state.wheelData[state.currentCardIndex];
      if (item) speakText(item.word, state.speech.accent);
    }
  }

  function speakCurrentCard(type) {
    const item = state.wheelData[state.currentCardIndex];
    if (!item) return;
    if (type === "word") speakText(item.word, state.speech.accent);
    if (type === "sentence") speakText(item.sentence, state.speech.accent);
  }

  function cardAction(type) {
    $("#flashcard").classList.remove("show");
    if (type === "got") {
      state.wheelEliminated.add(state.currentCardIndex);
      updateWheelStats();
      drawWheel();
    }
  }

  // -----------------------------
  // Events (delegation)
  // -----------------------------
  function bindEvents() {
    // filters
    $("#searchInput").addEventListener("input", () => {
      state.currentPage = 1;
      applyFilters();
    });
    $("#hideMarkedCheckbox").addEventListener("change", () => {
      state.currentPage = 1;
      applyFilters();
    });

    $("#pageSizeSelect").addEventListener("change", (e) => {
      state.itemsPerPage = parseInt(e.target.value, 10) || 20;
      state.currentPage = 1;
      renderTable();
      updatePagination();
    });

    // pagination
    $("#prevBtn").addEventListener("click", () => changePage(-1));
    $("#nextBtn").addEventListener("click", () => changePage(1));

    // wheel buttons
    $("#openWheelBtn").addEventListener("click", openWheel);
    $("#closeWheelBtn").addEventListener("click", closeWheel);
    $("#spinBtn").addEventListener("click", spinWheel);
    $("#modeEnCn").addEventListener("click", () => setWheelMode("en_cn"));
    $("#modeCnEn").addEventListener("click", () => setWheelMode("cn_en"));
    $("#refreshWheelBtn").addEventListener("click", refreshWheelRandomly);
    $("#revealBtn").addEventListener("click", revealAnswer);
    $("#missBtn").addEventListener("click", () => cardAction("miss"));
    $("#gotBtn").addEventListener("click", () => cardAction("got"));
    $("#speakWordBtn").addEventListener("click", () =>
      speakCurrentCard("word")
    );
    $("#speakSentenceBtn").addEventListener("click", () =>
      speakCurrentCard("sentence")
    );

    // click anywhere to unlock speech
    document.addEventListener("pointerdown", unlockSpeechOnce, {
      passive: true,
      once: true,
    });

    // table delegation for speak/mark
    $("#vocabTable").addEventListener("click", (e) => {
      const btnMark = e.target.closest("[data-toggle-mark]");
      if (btnMark) {
        toggleMark(btnMark.getAttribute("data-toggle-mark"));
        return;
      }
      const btnWord = e.target.closest("[data-speak-word]");
      if (btnWord) {
        speakText(btnWord.getAttribute("data-speak-word"), state.speech.accent);
        return;
      }
      const btnSentence = e.target.closest("[data-speak-sentence]");
      if (btnSentence) {
        speakText(
          btnSentence.getAttribute("data-speak-sentence"),
          state.speech.accent
        );
        return;
      }
    });

    // voice settings
    $("#accentSelect").addEventListener("change", (e) => {
      state.speech.accent = e.target.value;
      localStorage.setItem("speech_accent", state.speech.accent);
      state.speech.voiceURI = ""; // reset to auto when accent changes
      localStorage.setItem("speech_voiceURI", "");
      renderVoiceSelect();
      toast("口音已切换");
    });

    $("#voiceSelect").addEventListener("change", (e) => {
      state.speech.voiceURI = e.target.value || "";
      localStorage.setItem("speech_voiceURI", state.speech.voiceURI);
      toast(state.speech.voiceURI ? "已选择朗读声音" : "已切回自动选择");
    });

    $("#rateRange").addEventListener("input", (e) => {
      state.speech.rate = parseFloat(e.target.value);
      localStorage.setItem("speech_rate", String(state.speech.rate));
      $("#rateValue").textContent = state.speech.rate.toFixed(2);
    });

    $("#pitchRange").addEventListener("input", (e) => {
      state.speech.pitch = parseFloat(e.target.value);
      localStorage.setItem("speech_pitch", String(state.speech.pitch));
      $("#pitchValue").textContent = state.speech.pitch.toFixed(2);
    });

    $("#testVoiceBtn").addEventListener("click", () => {
      speakText(
        "Hello! Welcome back. Let's learn English.",
        state.speech.accent
      );
    });

    // Wheel close on ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#wheelOverlay").style.display !== "none")
        closeWheel();
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  function init() {
    processData();
    bindEvents();

    // init UI values
    $("#pageSizeSelect").value = String(state.itemsPerPage);
    $("#accentSelect").value = state.speech.accent;
    $("#rateRange").value = String(state.speech.rate);
    $("#pitchRange").value = String(state.speech.pitch);
    $("#rateValue").textContent = state.speech.rate.toFixed(2);
    $("#pitchValue").textContent = state.speech.pitch.toFixed(2);

    applyFilters();

    if ("speechSynthesis" in window) {
      refreshVoices();
      // Some browsers load voices async
      window.speechSynthesis.onvoiceschanged = () => refreshVoices();
    }
  }

  // Go
  init();
})();
