// flowContentScript.js — DOM automation for Google Labs Flow
// Uses exact same techniques as the original extension. Created with love by Redoun.

(() => {
  let isProcessing = false;
  let stopRequested = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function execInMain(funcBody, args = []) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: "executeInMainWorld", funcBody, args }, res => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(res || { success: false, error: "No response" });
      });
    });
  }

  // ── Inject text into Slate.js ─
  async function injectPrompt(text) {
    const result = await execInMain(`
      var text = args[0];

      function findEditorEl() {
        var by = document.evaluate(
          "//*[@data-scroll-state]//*[@data-slate-editor='true']",
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        if (by) return by;
        var all = document.querySelectorAll('[data-slate-editor="true"]');
        return all[1] || all[0] || null;
      }

      function getSlate(el) {
        var fk = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fk) throw new Error('No fiber');
        var n = el[fk];
        while (n) { var p = n.memoizedProps; if (p && p.editor && typeof p.editor.insertText==='function') return p.editor; n = n.return; }
        throw new Error('Slate not found');
      }

      function selectAll(slate) {
        var last = slate.children.length - 1;
        var lastLen = (slate.children[last]?.children?.[0]?.text || '').length;
        slate.select({ anchor:{path:[0,0],offset:0}, focus:{path:[last,0],offset:lastLen} });
      }

      return (async function() {
        var el = findEditorEl();
        if (!el) throw new Error('Editor not found');
        var slate = getSlate(el);

        el.focus(); el.click();
        selectAll(slate);

        try {
          var dt = new DataTransfer();
          dt.setData('text/plain', text);
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:dt }));
          var got = (el.textContent || '').trim();
          if (!got || got === text.trim() || got.includes(text.substring(0, Math.min(30, text.length)))) return true;
        } catch(_) {}

        selectAll(slate);
        slate.insertText(text);
        return true;
      })();
    `, [text]);
    if (!result.success) throw new Error("Inject failed: " + (result.error || result.result));
  }

  // ── Click submit via React fiber onClick ─
  async function clickSubmit() {
    const result = await execInMain(`
      var btns = Array.from(document.querySelectorAll('button'));
      var btn = btns.find(b => {
        var i = b.querySelector('i'); var s = b.querySelector('span');
        return i && i.textContent.trim()==='arrow_forward' && s && s.textContent.trim().length>0;
      });
      if (!btn) {
        btn = Array.from(document.querySelectorAll('button:not([disabled])')).slice(-1)[0];
      }
      if (!btn) return 'error:no button';

      var fk = Object.keys(btn).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fk) return 'error:no fiber';
      var n = btn[fk], fn = null;
      for (var i=0; i<50&&n; i++) {
        var p = n.memoizedProps;
        if (p && typeof p.onClick==='function') { fn=p.onClick; break; }
        n = n.return;
      }
      if (!fn) return 'error:no onClick';

      var ed = document.querySelector('[data-slate-editor="true"]');
      if (ed) ed.focus();

      fn({ isTrusted:true, type:'click', bubbles:true, cancelable:true,
           target:btn, currentTarget:btn,
           nativeEvent:{isTrusted:true,type:'click',target:btn},
           isDefaultPrevented:()=>false, isPropagationStopped:()=>false,
           preventDefault:()=>{}, stopPropagation:()=>{} });
      return 'ok';
    `);
    if (!result.success) throw new Error("Submit failed: " + result.error);
    if (typeof result.result === 'string' && result.result.startsWith('error:')) throw new Error(result.result);
  }

  // ── Download via context menu ─
  async function downloadTileViaUI(tileEl, targetQuality) {
    try {
      const media = tileEl.querySelector('video[src*="media.getMediaUrlRedirect"]')
                 || tileEl.querySelector('img[src*="media.getMediaUrlRedirect"]');
      if (!media) { console.warn("[FA] No media element in tile"); return false; }

      const o = media.getBoundingClientRect();
      const r = o.left + o.width / 2;
      const i = o.top + o.height / 2;

      media.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: r, clientY: i }));
      media.dispatchEvent(new MouseEvent("mousemove",  { bubbles: true, clientX: r, clientY: i }));
      await sleep(400);

      media.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: r, clientY: i, button: 2
      }));
      await sleep(600);

      const menuA = document.querySelector('[data-radix-menu-content][data-state="open"]');
      if (!menuA) { console.warn("[FA] Context menu did not open"); return false; }

      const dlItem = [...menuA.querySelectorAll('[role="menuitem"]')]
        .find(s => s.querySelector?.('i')?.textContent.trim() === "download");
      if (!dlItem) {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        console.warn("[FA] Download menuitem not found");
        return false;
      }

      dlItem.click();
      await sleep(600);

      const allMenus = [...document.querySelectorAll('[data-radix-menu-content][data-state="open"]')];
      const sub = allMenus.find(m => m !== menuA) || allMenus[allMenus.length - 1];

      if (!sub || sub === menuA) {
        console.warn("[FA] Quality sub-menu did not open");
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return false;
      }

      const qBtns = [...sub.querySelectorAll('button[role="menuitem"], button')];
      const opts = qBtns.map(b => {
        const lbl = (b.querySelectorAll("span")[0]?.textContent.trim()) || b.textContent.trim();
        const enabled = b.getAttribute("aria-disabled") !== "true";
        return { btn: b, label: lbl, enabled };
      });
      const enabled = opts.filter(o => o.enabled);

      let target = null;
      if (targetQuality) {
        const exact = opts.find(o => o.label === targetQuality);
        if (exact && exact.enabled) target = exact.btn;
        else if (exact && !exact.enabled) console.warn(`[FA] "${targetQuality}" is locked — using best available`);
      }
      if (!target && enabled.length > 0) target = enabled[enabled.length - 1].btn;
      if (!target && qBtns.length > 0) target = qBtns[0];

      if (target) {
        target.click();
        await sleep(300);
        console.log("[FA] Download triggered, quality:", targetQuality);
        return true;
      }

      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return false;
    } catch (e) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      console.error("[FA] downloadTileViaUI error:", e.message);
      return false;
    }
  }

  // ── Main handler — inject prompt and submit immediately, no waits ─
  async function handleCreateImage(req, sendResponse) {
    if (isProcessing) { sendResponse({ ok: false, error: "busy" }); return; }
    isProcessing = true;
    stopRequested = false;
    try {
      await injectPrompt(req.prompt);
      await clickSubmit();
      // No generation wait — AI takes whatever time it needs.
      // All inter-prompt delay is controlled by the user via frontend settings.
      sendResponse({ ok: true });
    } catch (e) {
      console.error("[FA]", e.message);
      sendResponse({ ok: false, error: e.message });
    } finally {
      isProcessing = false;
    }
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === "createimage")    { handleCreateImage(req, sendResponse); return true; }
    if (req.action === "stopProcessing") { stopRequested = true; isProcessing = false; sendResponse({ ok: true }); return false; }
    if (req.action === "getPageState")   {
      const m = window.location.href.match(/\/project\/([a-zA-Z0-9_-]{8,})/);
      sendResponse({ url: window.location.href, hasProject: !!m, projectId: m?.[1] || null, isProcessing });
      return false;
    }
  });

  console.log("[FA] Ready. Created with love by Redoun.");
})();
