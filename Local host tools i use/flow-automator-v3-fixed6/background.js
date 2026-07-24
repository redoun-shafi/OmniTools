// background.js — Flow Automator by Redoun v3

const QUEUE_KEY = "fa_queue_v3";

const saveQueue = q  => new Promise(r => chrome.storage.local.set({ [QUEUE_KEY]: q }, r));
const loadQueue = () => new Promise(r => chrome.storage.local.get(QUEUE_KEY, d => r(d[QUEUE_KEY] || null)));
const clearQueue = () => new Promise(r => chrome.storage.local.remove(QUEUE_KEY, r));

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.action.onClicked.addListener(tab => chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {}));
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ autoDownload: true, imageCount: 1, imageDownloadQuality: "1K" });
});

function getFlowTab() {
  return new Promise(r => {
    chrome.tabs.query({}, tabs => {
      r((tabs||[]).find(t => t.url?.includes("labs.google") && t.url?.includes("flow")) || null);
    });
  });
}
function extractProjectId(url) {
  const m = url?.match(/\/project\/([a-zA-Z0-9_-]{8,})/);
  return m ? m[1] : null;
}
async function checkConnection() {
  const tab = await getFlowTab();
  if (!tab) return { status:"disconnected", flowTabId:null, hasProject:false, projectId:null };
  const projectId = extractProjectId(tab.url);
  return { status:"connected", flowTabId:tab.id, hasProject:!!projectId, projectId, tabUrl:tab.url };
}
async function injectAntiThrottle(tabId) {
  try { await chrome.scripting.executeScript({ target:{tabId}, files:["alwaysActive.js"], world:"MAIN" }); }
  catch(e) {}
}
function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }
function sendToContent(tabId, message, timeoutMs = 210000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok:false, error:"timeout" }), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {}
        resolve(res || { ok:true });
      });
    } catch(e) { clearTimeout(timer); resolve({ ok:false, error:e.message }); }
  });
}

let stopFlag = false;
let currentFlowTabId = null;
let pausedIndex = -1;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Reset stuck running items back to pending
async function resetRunningItems() {
  const q = await loadQueue();
  if (!q?.items) return;
  let changed = false;
  q.items = q.items.map(item => {
    if (item.status === "running") {
      changed = true;
      return { ...item, status: "pending" };
    }
    return item;
  });
  if (changed) await saveQueue({ ...q, runningId: null });
}

// ── Queue item statuses: pending | running | done | skipped | error ──
// Queue shape: { items: [{id,prompt,status,addedAt}], settings, runningId }

async function runQueue(tabId, fromId = null) {
  stopFlag = false;
  currentFlowTabId = tabId;
  await injectAntiThrottle(tabId);
  await resetRunningItems();

  const q = await loadQueue();
  if (!q) { broadcast({ type:"NO_QUEUE" }); return; }

  // Find starting point
  let items = q.items;
  let startIdx = 0;
  if (fromId) {
    const idx = items.findIndex(x => x.id === fromId);
    if (idx >= 0) startIdx = idx;
  } else {
    // Find first pending
    startIdx = items.findIndex(x => x.status === "pending");
    if (startIdx < 0) { broadcast({ type:"BATCH_DONE", total: items.length }); return; }
  }

  const total = items.length;

  for (let i = startIdx; i < total; i++) {
    const q2 = await loadQueue();
    if (!q2) return;
    items = q2.items;

    if (stopFlag) {
      broadcast({ type:"BATCH_PAUSED" });
      return;
    }

    const item = items[i];
    if (!item) continue;
    if (item.status === "done" || item.status === "skipped") continue;
    if (item.status === "paused") {
      broadcast({ type:"ITEM_PAUSED", id: item.id });
      continue;
    }

    // Mark running
    items[i] = { ...item, status: "running" };
    await saveQueue({ ...q2, items, runningId: item.id });
    broadcast({ type:"QUEUE_UPDATE", items });
    broadcast({ type:"BATCH_PROGRESS", current: i+1, total, prompt: item.prompt, id: item.id });

    const result = await sendToContent(tabId, {
      action: "createimage",
      prompt: item.prompt,
      imageCount: q2.settings.imageCount || 1,
      autoDownload: q2.settings.autoDownload !== false,
      quality: q2.settings.imageDownloadQuality || "1K",
    });

    // Reload queue (user may have changed it while running)
    const q3 = await loadQueue();
    if (!q3) return;
    const freshIdx = q3.items.findIndex(x => x.id === item.id);
    if (freshIdx >= 0) {
      q3.items[freshIdx] = {
        ...q3.items[freshIdx],
        status: result?.ok ? "done" : "pending",
        doneAt: result?.ok ? Date.now() : null
      };
      await saveQueue({ ...q3, runningId: null });
      broadcast({ type:"QUEUE_UPDATE", items: q3.items });
      if (result?.ok) {
        broadcast({ type:"ITEM_DONE", id: item.id });
      }
    }

    if (stopFlag) {
      broadcast({ type:"BATCH_PAUSED" });
      return;
    }

    // Check if there are more pending items
    const q4 = await loadQueue();
    if (!q4) return;
    const nextPending = q4.items.slice(i + 1).find(x => x.status === "pending");
    if (!nextPending) break;

    // Exact delay — no randomness
    const delayMs = Math.max(0, (q4.settings.delaySec ?? 3)) * 1000;
    broadcast({ type:"COUNTDOWN_START", delayMs });
    const end = Date.now() + delayMs;
    while (Date.now() < end && !stopFlag) {
      broadcast({ type:"COUNTDOWN_TICK", msLeft: end - Date.now() });
      await sleep(200);
    }
  }

  const qf = await loadQueue();
  const allDone = qf?.items.every(x => x.status === "done" || x.status === "skipped");
  broadcast({ type:"BATCH_DONE", total: qf?.items.length || 0, allDone });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") { sendResponse({ pong:true }); return false; }

  if (msg.type === "CHECK_CONNECTION") {
    checkConnection().then(s => sendResponse({ state:s })).catch(() => sendResponse({ state:{status:"disconnected"} }));
    return true;
  }
  if (msg.type === "GET_FLOW_TAB") {
    getFlowTab().then(tab => sendResponse({ tab }));
    return true;
  }

  if (msg.type === "START_QUEUE") {
    sendResponse({ ok:true });
    getFlowTab().then(tab => {
      if (!tab) { broadcast({ type:"ERROR", msg:"Flow tab not found" }); return; }
      runQueue(tab.id, msg.fromId).catch(console.error);
    });
    return false;
  }
  if (msg.type === "STOP_QUEUE") {
    stopFlag = true;
    if (currentFlowTabId) chrome.tabs.sendMessage(currentFlowTabId, { action:"stopProcessing" }).catch(() => {});
    sendResponse({ ok:true });
    return false;
  }

  // Queue CRUD
  if (msg.type === "GET_QUEUE") {
    loadQueue().then(q => sendResponse({ queue:q }));
    return true;
  }
  if (msg.type === "SAVE_QUEUE") {
    saveQueue(msg.queue).then(() => sendResponse({ ok:true }));
    return true;
  }
  if (msg.type === "CLEAR_QUEUE") {
    clearQueue().then(() => sendResponse({ ok:true }));
    return true;
  }
  if (msg.type === "UPDATE_ITEM_STATUS") {
    loadQueue().then(async q => {
      if (!q) { sendResponse({ ok:false }); return; }
      const idx = q.items.findIndex(x => x.id === msg.id);
      if (idx >= 0) {
        q.items[idx] = { ...q.items[idx], status: msg.status };
        await saveQueue(q);
        broadcast({ type:"QUEUE_UPDATE", items: q.items });
      }
      sendResponse({ ok:true });
    });
    return true;
  }

  // MAIN world execution
  if (msg.action === "executeInMainWorld") {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success:false, error:"No tab ID" }); return; }
    chrome.scripting.executeScript({
      target:{tabId}, world:"MAIN",
      func:(funcBody, args) => {
        try {
          const fn = new Function("args", funcBody);
          const r = fn(args);
          if (r && typeof r.then === "function")
            return r.then(v=>({success:true,result:v})).catch(e=>({success:false,error:String(e?.message||e)}));
          return {success:true,result:r};
        } catch(e) { return {success:false,error:String(e?.message||e)}; }
      },
      args:[msg.funcBody, msg.args||[]],
    }).then(results => {
      const r = results?.[0]?.result;
      if (r && typeof r.then === "function") r.then(v=>sendResponse(v)).catch(e=>sendResponse({success:false,error:String(e)}));
      else sendResponse(r || {success:false,error:"No result"});
    }).catch(e => sendResponse({success:false,error:String(e?.message||e)}));
    return true;
  }
});
