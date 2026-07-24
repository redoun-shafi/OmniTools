// panel.js — Flow Automator v3. Created with love by Redoun.

(async () => {
  // ── Helpers ──────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(36);

  // ── Theme ────────────────────────────────────────────────────────
  let isLight = false;
  function applyTheme(light) {
    isLight = light;
    document.documentElement.classList.toggle("light", light);
    $("theme-btn").textContent = light ? "🌙" : "☀️";
    $("light-toggle").checked = light;
    chrome.storage.local.set({ faThemeLight: light });
  }
  chrome.storage.local.get("faThemeLight", d => applyTheme(!!d.faThemeLight));
  $("theme-btn").addEventListener("click", () => applyTheme(!isLight));
  $("light-toggle").addEventListener("change", e => applyTheme(e.target.checked));

  // ── Tabs ─────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".pane").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("pane-" + t.dataset.tab).classList.add("active");
      // Sticky footer (Start/Stop/Progress) only makes sense on the Queue tab
      $("queue-footer").classList.toggle("active", t.dataset.tab === "queue");
    });
  });

  // ── Settings persistence ─────────────────────────────────────────
  const SETTINGS_KEY = "fa_settings_v3";
  let settings = { delaySec: 3, autoDownload: true, imageDownloadQuality: "1K", imageCount: 1 };
  async function loadSettings() {
    return new Promise(r => chrome.storage.local.get(SETTINGS_KEY, d => {
      if (d[SETTINGS_KEY]) settings = { ...settings, ...d[SETTINGS_KEY] };
      $("delaySec").value     = settings.delaySec;
      $("autoDownload").checked = settings.autoDownload;
      $("quality").value      = settings.imageDownloadQuality;
      $("imageCount").value   = settings.imageCount;
      r();
    }));
  }
  function saveSettings() {
    settings = {
      delaySec: parseFloat($("delaySec").value) || 3,
      autoDownload: $("autoDownload").checked,
      imageDownloadQuality: $("quality").value,
      imageCount: parseInt($("imageCount").value) || 1,
    };
    chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  ["delaySec","autoDownload","quality","imageCount"].forEach(id => {
    $(id)?.addEventListener("change", saveSettings);
  });
  await loadSettings();

  // ── Queue state ──────────────────────────────────────────────────
  let qItems = []; // [{id,prompt,status,addedAt}]
  let isRunning = false;
  let cdTotal = 0;

  async function loadQueueFromBg() {
    const res = await sendMsg({ type:"GET_QUEUE" });
    if (res?.queue?.items) {
      qItems = res.queue.items;
    } else {
      qItems = [];
    }
    renderQueue();
  }

  async function saveQueueToBg() {
    await sendMsg({ type:"SAVE_QUEUE", queue: { items: qItems, settings } });
  }

  // ── Queue CRUD ───────────────────────────────────────────────────
  function addPrompts(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    lines.forEach(p => {
      qItems.push({ id: uuid(), prompt: p, status: "pending", addedAt: Date.now() });
    });
    saveQueueToBg();
    renderQueue();
    $("new-prompt").value = "";
  }

  function deleteItem(id) {
    qItems = qItems.filter(x => x.id !== id);
    saveQueueToBg();
    renderQueue();
  }

  function togglePause(id) {
    const item = qItems.find(x => x.id === id);
    if (!item) return;
    if (item.status === "paused") {
      item.status = "pending";
    } else if (item.status === "pending") {
      item.status = "paused";
    }
    saveQueueToBg();
    renderQueue();
  }

  function restartItem(id) {
    const item = qItems.find(x => x.id === id);
    if (!item) return;
    item.status = "pending";
    item.doneAt = null;
    saveQueueToBg();
    renderQueue();
  }

  function clearDone() {
    qItems = qItems.filter(x => x.status !== "done" && x.status !== "error" && x.status !== "skipped");
    saveQueueToBg();
    renderQueue();
  }

  function clearAll() {
    if (!confirm("Clear entire queue?")) return;
    qItems = [];
    saveQueueToBg();
    renderQueue();
  }

  // ── Render queue ─────────────────────────────────────────────────
  function renderQueue() {
    const list = $("q-list");
    const pending = qItems.filter(x => x.status === "pending" || x.status === "running" || x.status === "paused").length;
    const done = qItems.filter(x => x.status === "done").length;
    $("q-pending").textContent = pending;
    $("q-done").textContent = done;

    list.innerHTML = "";
    qItems.forEach((item, idx) => {
      const div = document.createElement("div");
      div.className = "q-item " + item.status;
      div.dataset.id = item.id;

      const statusLabel = {
        pending: "Pending",
        running: "⚡ Generating…",
        done: "✓ Done",
        paused: "⏸ Paused",
        error: "✗ Error",
        skipped: "→ Skipped",
      }[item.status] || item.status;

      // Actions based on status
      let actions = "";
      if (item.status === "done" || item.status === "error" || item.status === "skipped") {
        actions += `<button class="qa play" data-action="restart" title="Re-run">↺</button>`;
      }
      if (item.status === "pending") {
        actions += `<button class="qa" data-action="pause" title="Skip/Pause">⏸</button>`;
      }
      if (item.status === "paused") {
        actions += `<button class="qa play" data-action="unpause" title="Resume">▶</button>`;
      }
      if (item.status !== "running") {
        actions += `<button class="qa del" data-action="delete" title="Delete">✕</button>`;
      }

      div.innerHTML = `
        <div class="q-num">${idx + 1}</div>
        <div class="q-body">
          <div class="q-prompt">${escHtml(item.prompt)}</div>
          <div class="q-status">${statusLabel}</div>
        </div>
        <div class="q-actions">${actions}</div>`;

      div.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const a = btn.dataset.action;
          if (a === "delete")   deleteItem(item.id);
          if (a === "pause")    togglePause(item.id);
          if (a === "unpause")  togglePause(item.id);
          if (a === "restart")  restartItem(item.id);
        });
      });

      list.appendChild(div);
    });
  }

  function escHtml(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── Add prompt button / keyboard ─────────────────────────────────
  $("btn-add").addEventListener("click", () => addPrompts($("new-prompt").value));
  $("new-prompt").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); addPrompts($("new-prompt").value); }
  });
  $("btn-clear-done").addEventListener("click", clearDone);
  $("btn-clear-all").addEventListener("click", clearAll);

  // ── Status ───────────────────────────────────────────────────────
  const sp = $("sp"), sdot = $("sdot"), stxt = $("stxt");

  function setStatus(type, text) {
    sp.className = "sp " + type;
    sdot.className = "dot" + (type==="project"?" p pulse":type==="connected"?" g":" r");
    stxt.className = "st" + (type==="project"?" p":type==="connected"?" g":"");
    stxt.textContent = text;
    $("btn-open-flow").style.display = type === "disconnected" ? "block" : "none";
  }

  async function sendMsg(msg) {
    return new Promise(r => {
      try { chrome.runtime.sendMessage(msg, res => r(chrome.runtime.lastError ? null : res)); }
      catch { r(null); }
    });
  }

  async function checkConn(silent=false) {
    if (!silent) setStatus("checking","Checking…");
    const ping = await sendMsg({ type:"PING" });
    if (!ping?.pong) { setStatus("disconnected","Extension error — reload"); return { status:"disconnected" }; }
    const res = await sendMsg({ type:"CHECK_CONNECTION" });
    const s = res?.state || { status:"disconnected" };
    if (s.status==="connected" && s.hasProject) setStatus("project","✦ Project detected — ready");
    else if (s.status==="connected")             setStatus("connected","Flow open — open a project");
    else                                         setStatus("disconnected","Not connected — open Flow");
    return s;
  }

  await checkConn();
  setInterval(() => checkConn(true), 3000);

  $("btn-open-flow").addEventListener("click", () => {
    chrome.tabs.create({ url:"https://labs.google/fx/tools/flow" });
  });

  // Load existing queue
  await loadQueueFromBg();

  // ── Start / Stop ─────────────────────────────────────────────────
  $("btn-start").addEventListener("click", async () => {
    const pending = qItems.filter(x => x.status === "pending");
    if (!pending.length) { alert("No pending prompts in queue."); return; }
    const s = await checkConn();
    if (s.status !== "connected") { alert("Open labs.google/fx/tools/flow and open a project."); return; }
    if (!s.hasProject) { alert("Open a project in Flow first."); return; }

    saveSettings();
    // Sync settings to queue
    const q = { items: qItems, settings };
    await sendMsg({ type:"SAVE_QUEUE", queue: q });

    setRunning(true);
    $("prog-wrap").style.display = "block";
    $("prog-status").textContent = "Starting…";
    $("prog-frac").textContent = `0 / ${pending.length}`;
    $("prog-fill").style.width = "0%";
    $("prog-prompt").textContent = "";

    await sendMsg({ type:"START_QUEUE" });
  });

  $("btn-stop").addEventListener("click", async () => {
    await sendMsg({ type:"STOP_QUEUE" });
    setRunning(false);
    $("prog-status").textContent = "Stopped";
    hideCd();
  });

  function setRunning(v) {
    isRunning = v;
    $("btn-start").disabled = v;
    $("btn-stop").style.display = v ? "block" : "none";
  }

  // ── Countdown ────────────────────────────────────────────────────
  function showCd(msLeft, total) {
    if (total) cdTotal = total;
    const row = $("cd-row"), bar = $("cd-bar"), num = $("cd-num");
    row.classList.add("on");
    const pct = cdTotal > 0 ? Math.max(0, (msLeft/cdTotal)*100) : 100;
    bar.style.width = pct + "%";
    const s = Math.ceil(msLeft/1000);
    num.textContent = s > 0 ? s + "s" : "0s";
  }
  function hideCd() { $("cd-row").classList.remove("on"); }

  // ── Background messages ───────────────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "QUEUE_UPDATE") {
      qItems = msg.items;
      renderQueue();
    }
    if (msg.type === "BATCH_PROGRESS") {
      hideCd();
      const done = qItems.filter(x=>x.status==="done").length;
      const total = qItems.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      $("prog-status").textContent = `Generating ${msg.current} of ${msg.total}`;
      $("prog-frac").textContent = `${msg.current} / ${msg.total}`;
      $("prog-fill").style.width = pct + "%";
      $("prog-prompt").textContent = msg.prompt || "";
    }
    if (msg.type === "COUNTDOWN_START") {
      cdTotal = msg.delayMs;
    }
    if (msg.type === "COUNTDOWN_TICK") {
      $("prog-status").textContent = `⏱ Next in ${Math.ceil(msg.msLeft/1000)}s`;
      showCd(msg.msLeft, cdTotal);
    }
    if (msg.type === "BATCH_DONE") {
      setRunning(false);
      hideCd();
      const total = qItems.filter(x=>x.status==="done").length;
      $("prog-status").textContent = `✓ Done — ${total} prompt${total!==1?"s":""}`;
      $("prog-frac").textContent = `${total} / ${qItems.length}`;
      $("prog-fill").style.width = "100%";
      $("prog-prompt").textContent = "All completed!";
    }
    if (msg.type === "BATCH_PAUSED") {
      setRunning(false);
      hideCd();
      $("prog-status").textContent = "Paused";
    }
    if (msg.type === "ITEM_DONE") {
      const item = qItems.find(x=>x.id===msg.id);
      if (item) item.status = "done";
      renderQueue();
    }
    if (msg.type === "ITEM_PAUSED") {
      const item = qItems.find(x=>x.id===msg.id);
      if (item) item.status = "paused";
      renderQueue();
    }
    if (msg.type === "NO_QUEUE") {
      setRunning(false);
      $("prog-status").textContent = "No queue found";
    }
  });
})();
