// FlowPix AI v4 — Flow bridge/content script
// Runs in the extension isolated world and delegates DOM interaction to the
// page's MAIN world through the background service worker.
(() => {
  let busy = false;
  let stopRequested = false;

  const send = (msg) => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) resolve({ success:false, error:chrome.runtime.lastError.message });
        else resolve(res || { success:false, error:'No response' });
      });
    } catch (e) { resolve({ success:false, error:String(e) }); }
  });

  const runTask = (task, args = []) => send({ action:'runMainWorldTask', task, args });

  async function pageState() {
    return runTask('inspectFlow');
  }

  async function handleCreateImage(req, sendResponse) {
    if (busy) { sendResponse({ ok:false, error:'Automation is busy' }); return; }
    busy = true;
    stopRequested = false;
    try {
      const ready = await pageState();
      if (!ready?.success || !ready?.flowDetected) {
        throw new Error(ready?.error || 'Google Flow page was not detected');
      }
      if (!ready.projectDetected) throw new Error('Flow project was not detected');

      if (stopRequested) throw new Error('Stopped');
      const submitted = await runTask('nativeInsertAndClick', [req.prompt]);
      if (!submitted?.success) throw new Error(submitted?.error || 'Prompt insertion/send failed');

      if (stopRequested) throw new Error('Stopped');

      // Fast queue mode: once the native send action succeeds, release the
      // content-script lock immediately. We intentionally do NOT wait for
      // Flow's image generation state. The background queue controls a fixed
      // 5-second cadence and sends the next prompt after that interval.
      sendResponse({ ok:true, diagnostics:{ submitted:true, verification:false } });
    } catch (e) {
      sendResponse({ ok:false, error:String(e?.message || e) });
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'createimage') { handleCreateImage(req, sendResponse); return true; }
    if (req.action === 'stopProcessing') {
      stopRequested = true;
      sendResponse({ ok:true });
      return false;
    }
    if (req.action === 'getPageState') {
      pageState().then(r => sendResponse(r));
      return true;
    }
    if (req.action === 'testPromptInsertion') {
      runTask('nativeInsertOnly', [req.prompt || 'FlowPix AI Test Prompt'])
        .then(r => sendResponse(r));
      return true;
    }
    if (req.action === 'inspectFlow') {
      pageState().then(r => sendResponse(r));
      return true;
    }
    if (req.action === 'pingFlow') {
      pageState().then(r => sendResponse({ ok:true, page:r })).catch(() => sendResponse({ ok:false }));
      return true;
    }
  });

  // Announce that the content script is alive. This also helps the side panel
  // distinguish a Flow tab from a Flow tab that has not loaded our script.
  send({ type:'FLOW_CONTENT_READY', url:location.href });
})();
