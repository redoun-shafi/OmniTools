// FlowPix AI v4 — MV3 service worker
const QUEUE_KEY = 'fa_queue_v4';
const SETTINGS_KEY = 'fa_settings_v4';

const storageGet = key => new Promise(r => chrome.storage.local.get(key, d => r(d[key])));
const storageSet = obj => new Promise(r => chrome.storage.local.set(obj, r));
const storageRemove = key => new Promise(r => chrome.storage.local.remove(key, r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick:true }).catch(()=>{});
chrome.action?.onClicked.addListener(tab => chrome.sidePanel?.open({ tabId:tab.id }).catch(()=>{}));
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([QUEUE_KEY, SETTINGS_KEY], d => {
    const p = [];
    if (!d[QUEUE_KEY]) p.push(storageSet({ [QUEUE_KEY]:{items:[], settings:{delaySec:5, imageCount:1}, runningId:null} }));
    if (!d[SETTINGS_KEY]) p.push(storageSet({ [SETTINGS_KEY]:{delaySec:5, imageCount:1, maxRetries:3, generationTimeoutSec:240, verificationTimeoutSec:15} }));
    Promise.all(p).catch(()=>{});
  });
});

function isFlowUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === 'flow.google' || h === 'flow.google.com' || h.endsWith('.flow.google') || h.endsWith('.flow.google.com') || ((h === 'labs.google' || h.endsWith('.labs.google')) && /flow/i.test(u.pathname + u.search));
  } catch { return false; }
}

function extractProjectId(url) {
  const m = String(url || '').match(/\/project\/([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}

async function getFlowTabs() {
  const tabs = await new Promise(r => chrome.tabs.query({}, r));
  return (tabs || []).filter(t => isFlowUrl(t.url));
}

async function getFlowTab(preferId = null) {
  if (preferId) {
    try {
      const t = await new Promise(r => chrome.tabs.get(preferId, x => r(x || null)));
      if (t && isFlowUrl(t.url)) return t;
    } catch {}
  }
  const tabs = await getFlowTabs();
  return tabs.find(t => t.active) || tabs.find(t => extractProjectId(t.url)) || tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    const ping = await new Promise(resolve => chrome.tabs.sendMessage(tabId, { action:'pingFlow' }, r => {
      if (chrome.runtime.lastError) resolve(null); else resolve(r || null);
    }));
    if (ping?.ok) return true;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target:{tabId}, files:['flowContentScript.js'] });
    await sleep(250);
    return true;
  } catch { return false; }
}

async function inspectConnection(tabId = null) {
  const tab = await getFlowTab(tabId);
  if (!tab) return { status:'disconnected', flowTabId:null, hasProject:false, projectId:null, contentScript:false };
  const projectId = extractProjectId(tab.url);
  const contentScript = await ensureContentScript(tab.id);
  let page = null;
  if (contentScript) {
    page = await new Promise(resolve => chrome.tabs.sendMessage(tab.id, { action:'inspectFlow' }, r => {
      if (chrome.runtime.lastError) resolve(null); else resolve(r || null);
    }));
  }
  const hasProject = !!projectId || !!page?.projectDetected;
  const ready = !!page?.success && !!page?.flowDetected && !!page?.editorDetected;
  return {
    status: ready ? 'ready' : (contentScript ? 'connected' : 'disconnected'),
    flowTabId:tab.id,
    hasProject,
    projectId:projectId || page?.projectId || null,
    tabUrl:tab.url,
    contentScript,
    page
  };
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(()=>{}); }

function sendToContent(tabId, message, timeoutMs = 270000) {
  return new Promise(resolve => {
    let finished = false;
    const done = r => { if (finished) return; finished=true; clearTimeout(timer); resolve(r || {ok:false,error:'No response'}); };
    const timer = setTimeout(() => done({ok:false,error:'Automation timeout'}), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, r => {
        if (chrome.runtime.lastError) done({ok:false,error:chrome.runtime.lastError.message});
        else done(r || {ok:false,error:'No response'});
      });
    } catch(e) { done({ok:false,error:String(e?.message||e)}); }
  });
}

let stopFlag = false;
let currentFlowTabId = null;
const debuggerSessions = new Map();

async function loadQueue() { return (await storageGet(QUEUE_KEY)) || {items:[],settings:{delaySec:5,imageCount:1},runningId:null}; }
async function saveQueue(q) { await storageSet({[QUEUE_KEY]:q}); }

async function resetInterrupted() {
  const q = await loadQueue();
  let changed=false;
  for (const item of q.items || []) {
    if (['running','preparing','inserting','verifying','submitting','generating','retrying','recovery'].includes(item.status)) {
      item.status='pending'; item.error=null; changed=true;
    }
  }
  if (changed) { q.runningId=null; await saveQueue(q); }
}

async function runQueue(tabId) {
  stopFlag=false; currentFlowTabId=tabId;
  await ensureContentScript(tabId);
  await ensureDebuggerSession(tabId);
  try {
  await resetInterrupted();
  let q = await loadQueue();
  const total = q.items.length;
  if (!total) { broadcast({type:'NO_QUEUE'}); return; }

  for (let i=0; i<total; i++) {
    if (stopFlag) { broadcast({type:'BATCH_PAUSED'}); return; }
    q = await loadQueue();
    const item = q.items[i];
    if (!item || ['done','skipped','paused'].includes(item.status)) continue;
    if (item.status !== 'pending' && item.status !== 'error') continue;

    const maxRetries = Math.max(1, Number(q.settings?.maxRetries || 3));
    let result = {ok:false,error:'Unknown error'};
    for (let attempt=1; attempt<=maxRetries; attempt++) {
      if (stopFlag) { broadcast({type:'BATCH_PAUSED'}); return; }
      q = await loadQueue();
      const idx = q.items.findIndex(x => x.id === item.id);
      if (idx < 0) break;
      q.items[idx] = {...q.items[idx], status: attempt===1?'running':'retrying', attempt, retryCount:attempt-1, error:null};
      q.runningId=item.id;
      await saveQueue(q);
      broadcast({type:'QUEUE_UPDATE',items:q.items});
      broadcast({type:'BATCH_PROGRESS',current:i+1,total,prompt:item.prompt,id:item.id,attempt});

      result = await sendToContent(tabId,{action:'createimage',prompt:item.prompt,imageCount:q.settings?.imageCount||1},270000);
      if (result?.ok) break;
      q = await loadQueue();
      const idx2=q.items.findIndex(x=>x.id===item.id);
      if (idx2>=0) { q.items[idx2]={...q.items[idx2],status:'retrying',error:result?.error||'Generation failed'}; await saveQueue(q); broadcast({type:'ITEM_RETRY',id:item.id,attempt,error:result?.error}); }
      if (attempt<maxRetries) await sleep(Math.max(250,Number(q.settings?.retryDelaySec||2)*1000));
    }

    q = await loadQueue();
    const idx=q.items.findIndex(x=>x.id===item.id);
    if (idx>=0) {
      if (result?.ok) {
        q.items[idx]={...q.items[idx],status:'done',error:null,doneAt:Date.now()};
        q.runningId=null; await saveQueue(q);
        broadcast({type:'QUEUE_UPDATE',items:q.items});
        broadcast({type:'ITEM_DONE',id:item.id});
      } else {
        q.items[idx]={...q.items[idx],status:'error',error:result?.error||'Unknown error'};
        q.runningId=null; await saveQueue(q);
        broadcast({type:'QUEUE_UPDATE',items:q.items});
        broadcast({type:'ITEM_ERROR',id:item.id,error:q.items[idx].error});
        broadcast({type:'BATCH_ERROR',error:q.items[idx].error,prompt:item.prompt});
        return;
      }
    }

    const next = (await loadQueue()).items.slice(i+1).find(x=>x.status==='pending');
    if (!next) break;
    const delayMs=5000;
    const end=Date.now()+delayMs;
    broadcast({type:'COUNTDOWN_START',delayMs});
    while(Date.now()<end){ if(stopFlag){broadcast({type:'BATCH_PAUSED'});return;} broadcast({type:'COUNTDOWN_TICK',msLeft:end-Date.now()}); await sleep(250); }
  }
  q=await loadQueue();
  const done=q.items.filter(x=>x.status==='done').length;
  broadcast({type:'BATCH_DONE',total:q.items.length,done});
  } finally {
    await releaseDebuggerSession(tabId);
    if (currentFlowTabId===tabId) currentFlowTabId=null;
  }
}

// ---------- MAIN-world automation ----------
// IMPORTANT: this function is completely self-contained because Chrome
// serializes only the function body when executeScript({world:'MAIN',func}) is used.
async function flowMainTask(task, args) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
  const textOf = el => ((el?.innerText||el?.textContent||el?.value||'')+'').trim();
  const deepElements = () => {
    const out=[];
    const walk=root=>{
      if(!root?.querySelectorAll) return;
      for(const n of Array.from(root.querySelectorAll('*'))){ out.push(n); if(n.shadowRoot) walk(n.shadowRoot); }
    };
    walk(document); return out;
  };
  const findEditor = () => {
    const cs=[];
    for(const el of deepElements()){
      if(!visible(el)) continue;
      const ce=el.getAttribute?.('contenteditable');
      const role=(el.getAttribute?.('role')||'').toLowerCase();
      const tag=(el.tagName||'').toLowerCase();
      if(!(ce==='true'||role==='textbox'||tag==='textarea'||tag==='input')) continue;
      const ph=(el.getAttribute?.('placeholder')||el.getAttribute?.('aria-label')||el.getAttribute?.('title')||'');
      const parent=textOf(el.parentElement).slice(0,700);
      const hay=(ph+' '+parent).toLowerCase();
      let score=0;
      if(ce==='true') score+=35;
      if(role==='textbox') score+=22;
      if(/what do you want to create|create|prompt|describe|imagine|generate/.test(hay)) score+=55;
      if(/search|rename|title|project name/.test(hay)) score-=50;
      const r=el.getBoundingClientRect();
      if(r.top>innerHeight*.50) score+=20;
      if(r.width>250) score+=10;
      if(r.height>30) score+=5;
      cs.push({el,score});
    }
    cs.sort((a,b)=>b.score-a.score);
    return cs[0]?.el||null;
  };
  const findGenerateButton = editor => {
    const btns=[];
    for(const el of deepElements()){
      if(!visible(el)) continue;
      const tag=(el.tagName||'').toLowerCase(), role=(el.getAttribute?.('role')||'').toLowerCase();
      if(tag!=='button'&&role!=='button') continue;
      const label=((el.getAttribute?.('aria-label')||'')+' '+(el.getAttribute?.('title')||'')+' '+textOf(el)).trim();
      const cls=(el.className||'').toString();
      const icon=textOf(el.querySelector?.('svg,mat-icon,i,[class*="icon"]'));
      const hay=(label+' '+cls+' '+icon).toLowerCase();
      let score=0;
      if(/generate|create image|create video|submit|send/.test(hay)) score+=70;
      if(/arrow_forward|arrow_right|arrowforward|arrowright|east|send|play_arrow/.test(hay)) score+=35;
      if(editor && (editor.parentElement?.contains(el) || editor.closest?.('form')?.contains(el))) score+=25;
      const r=el.getBoundingClientRect();
      if(r.bottom>innerHeight*.50) score+=15;
      const disabled=!!el.disabled||el.getAttribute?.('aria-disabled')==='true';
      if(!disabled) score+=5;
      btns.push({el,score,disabled,label,rect:{x:r.x,y:r.y,w:r.width,h:r.height}});
    }
    btns.sort((a,b)=>b.score-a.score);
    return btns.find(x=>x.score>=45&&!x.disabled)||null;
  };
  const inspect = () => {
    const editor=findEditor();
    const button=findGenerateButton(editor);
    const projectId=(location.href.match(/\/project\/([a-zA-Z0-9_-]{6,})/)||[])[1]||null;
    const flowDetected=/flow\.google|labs\.google/i.test(location.hostname);
    const body=(document.body?.innerText||'').toLowerCase();
    return {
      success:true,
      flowDetected,
      projectDetected:!!projectId||/project\//i.test(location.pathname),
      projectId,
      editorDetected:!!editor,
      generateButtonDetected:!!button,
      editorTag:editor?.tagName||null,
      editorRole:editor?.getAttribute?.('role')||null,
      editorPlaceholder:editor?.getAttribute?.('placeholder')||editor?.getAttribute?.('aria-label')||null,
      generateLabel:button?.label||null,
      generatingText:/generating|creating|processing|queued/.test(body)
    };
  };

  if(task==='inspectFlow') return inspect();

  if(task==='getEditorTarget'){
    const el=findEditor();
    if(!el) return {success:false,error:'Flow prompt editor not found'};
    const r=el.getBoundingClientRect();
    return {success:true,tag:el.tagName,role:el.getAttribute?.('role')||'',rect:{left:r.left,top:r.top,width:r.width,height:r.height},text:textOf(el).slice(0,240)};
  }

  if(task==='getSubmitTarget'){
    const editor=findEditor();
    const btn=findGenerateButton(editor);
    if(!btn) return {success:false,error:'Flow Generate/Create button not found'};
    return {success:true,label:btn.label,rect:btn.rect};
  }

  if(task==='readEditor'){
    const el=findEditor();
    if(!el) return {success:false,error:'Flow prompt editor not found'};
    return {success:true,text:textOf(el).replace(/\u00a0/g,' ').trim()};
  }

  if(task==='injectPrompt'){
    const wanted=String(args?.[0]||'').trim();
    const el=findEditor();
    if(!el) return {success:false,error:'Flow prompt editor not found'};
    const read=()=>textOf(el).replace(/\u00a0/g,' ').trim();
    const matches=()=>{const got=read(); return got===wanted || got.includes(wanted) || (wanted.length>20 && got.includes(wanted.slice(0,Math.min(40,wanted.length))));};
    const select=()=>{const range=document.createRange();range.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);};
    try{el.focus();el.click();}catch{}
    // Attempt A: browser-native editing command.
    try{select();document.execCommand('delete',false,null);document.execCommand('insertText',false,wanted);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:wanted}));await sleep(250);if(matches())return {success:true,method:'execCommand',editorTag:el.tagName};}catch{}
    // Attempt B: beforeinput + execCommand.
    try{select();el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:wanted}));document.execCommand('insertText',false,wanted);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:wanted}));await sleep(350);if(matches())return {success:true,method:'beforeinput+execCommand',editorTag:el.tagName};}catch{}
    // Attempt C: native setter for input/textarea.
    try{if('value' in el){const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter){setter.call(el,wanted);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));await sleep(300);if(matches())return {success:true,method:'nativeValue',editorTag:el.tagName};}}}catch{}
    return {success:false,error:'Prompt was inserted but Flow did not retain the text',editorTag:el.tagName,editorRole:el.getAttribute?.('role')||'',editorPlaceholder:el.getAttribute?.('placeholder')||el.getAttribute?.('aria-label')||'',actualText:read().slice(0,180)};
  }

  if(task==='clickSubmitAndVerify'){
    const expected=String(args?.[0]||'').trim();
    const editor=findEditor();
    if(!editor) return {success:false,error:'Prompt editor disappeared before submit'};
    const current=textOf(editor).replace(/\u00a0/g,' ').trim();
    if(!current.includes(expected)) return {success:false,error:'Prompt verification failed before submit'};
    const btn=findGenerateButton(editor);
    if(!btn) return {success:false,error:'Flow Generate/Create button not found'};
    try{btn.el.focus();btn.el.click();}catch{}
    try{const r=btn.el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,opts={bubbles:true,cancelable:true,view:window,clientX:x,clientY:y};for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){const C=t.startsWith('pointer')&&window.PointerEvent?PointerEvent:MouseEvent;btn.el.dispatchEvent(new C(t,opts));}}catch{}
    await sleep(400);
    return {success:true,method:'verifiedClick',buttonLabel:btn.label};
  }

  if(task==='waitForGenerationStart'){
    const timeout=Number(args?.[1]||15000), start=Date.now();
    let changed=0, initial=inspect();
    while(Date.now()-start<timeout){
      const state=inspect();
      const body=(document.body?.innerText||'').toLowerCase();
      if(state.generatingText || /generating|creating|processing|queued/.test(body)) return {success:true,reason:'generation-status'};
      if(state.editorDetected===false) { changed++; if(changed>=2) return {success:true,reason:'composer-state-changed'}; }
      if(state.generateButtonDetected===false) { changed++; if(changed>=2) return {success:true,reason:'generate-control-disabled-or-hidden'}; }
      if(initial.editorTag!==state.editorTag || initial.editorPlaceholder!==state.editorPlaceholder) { changed++; if(changed>=2) return {success:true,reason:'composer-rerendered'}; }
      await sleep(500);
    }
    return {success:false,error:'Generation start could not be verified'};
  }

  if(task==='waitForGenerationComplete'){
    const timeout=Number(args?.[1]||240000), start=Date.now();
    let sawActivity=false, stable=0, initial=inspect();
    const initialMedia=deepElements().filter(e=>['img','video'].includes((e.tagName||'').toLowerCase())).length;
    while(Date.now()-start<timeout){
      const state=inspect();
      const body=(document.body?.innerText||'').toLowerCase();
      const media=deepElements().filter(e=>['img','video'].includes((e.tagName||'').toLowerCase())).length;
      const busyText=/generating|creating|processing|queued/.test(body);
      if(busyText){sawActivity=true;stable=0;await sleep(1000);continue;}
      if(media>initialMedia){sawActivity=true;}
      // Flow commonly returns the composer to an idle/ready state after the
      // generation card is created. If the Generate control is back and the
      // page is no longer reporting generation, treat that as completion after
      // a few stable observations.
      if(state.generateButtonDetected && (state.editorDetected || state.projectDetected)){
        if(sawActivity || Date.now()-start>3000){stable++;if(stable>=3)return {success:true,reason:'flow-returned-to-ready'};}
      } else { stable=0; }
      await sleep(1000);
    }
    return {success:false,error:'Generation timed out'};
  }

  return {success:false,error:'Unknown Flow task: '+task};
}


async function ensureDebuggerSession(tabId) {
  if (debuggerSessions.has(tabId)) return debuggerSessions.get(tabId).send;
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  const session = {
    target,
    send: async (method, params = {}) => {
      if (!method || typeof method !== 'string') throw new Error('CDP command method missing');
      return await chrome.debugger.sendCommand(target, method, params || {});
    }
  };
  debuggerSessions.set(tabId, session);
  return session.send;
}

async function releaseDebuggerSession(tabId) {
  const session = debuggerSessions.get(tabId);
  if (!session) return;
  debuggerSessions.delete(tabId);
  try { await chrome.debugger.detach(session.target); } catch (_) {}
}

async function withDebuggerSend(tabId, fn) {
  const send = await ensureDebuggerSession(tabId);
  return await fn(send);
}

async function nativeInsertOnly(tabId,prompt){
  const execMain=(task,args=[])=>new Promise(resolve=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:flowMainTask,args:[task,args]}).then(r=>resolve(r?.[0]?.result||{success:false,error:'No result'})).catch(e=>resolve({success:false,error:String(e?.message||e)})));
  const editor=await execMain('getEditorTarget');
  if(!editor?.success) return editor;
  const er=editor.rect || {};
  const eLeft=Number(er.left), eTop=Number(er.top), eWidth=Number(er.width), eHeight=Number(er.height);
  if (![eLeft,eTop,eWidth,eHeight].every(Number.isFinite) || eWidth <= 0 || eHeight <= 0) return {success:false,error:'Flow editor coordinates are invalid',editorRect:er};
  const ex=Math.round(eLeft+eWidth/2), ey=Math.round(eTop+eHeight/2);
  const isMac=/Mac/i.test(navigator.platform||'');
  await withDebuggerSend(tabId,async send=>{
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:ex,y:ey});
    await send('Input.dispatchMouseEvent', {type:'mousePressed',x:ex,y:ey,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:ex,y:ey,button:'left',clickCount:1});
    await sleep(100);
    const modifiers=isMac?4:2;
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:isMac?'Meta':'Control',code:isMac?'MetaLeft':'ControlLeft',modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:isMac?'Meta':'Control',code:isMac?'MetaLeft':'ControlLeft',modifiers:0});
    await send('Input.insertText', {text:String(prompt||'')});
  });
  await sleep(700);
  const verify=await execMain('readEditor');
  if(!verify?.success) return {success:false,error:verify?.error||'Could not read Flow editor after native input'};
  const actual=String(verify.text||''), expected=String(prompt||'').trim();
  const ok=actual===expected||actual.includes(expected)||(expected.length>20&&actual.includes(expected.slice(0,60)));
  return ok ? {success:true,method:'CDP-native-input',actualText:actual.slice(0,240)} : {success:false,error:'Flow did not accept the native prompt input',actualText:actual.slice(0,240)};
}

async function nativeInsertAndClick(tabId,prompt){
  const execMain=(task,args=[])=>new Promise(resolve=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:flowMainTask,args:[task,args]}).then(r=>resolve(r?.[0]?.result||{success:false,error:'No result'})).catch(e=>resolve({success:false,error:String(e?.message||e)})));
  const editor=await execMain('getEditorTarget');
  if(!editor?.success) return editor;
  const er=editor.rect || {};
  const eLeft=Number(er.left), eTop=Number(er.top), eWidth=Number(er.width), eHeight=Number(er.height);
  if (![eLeft,eTop,eWidth,eHeight].every(Number.isFinite) || eWidth <= 0 || eHeight <= 0) return {success:false,error:'Flow editor coordinates are invalid',editorRect:er};
  const ex=Math.round(eLeft+eWidth/2), ey=Math.round(eTop+eHeight/2);
  const isMac=/Mac/i.test(navigator.platform||'');
  await withDebuggerSend(tabId,async send=>{
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:ex,y:ey});
    await send('Input.dispatchMouseEvent', {type:'mousePressed',x:ex,y:ey,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:ex,y:ey,button:'left',clickCount:1});
    await sleep(100);
    const modifiers=isMac?4:2;
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:isMac?'Meta':'Control',code:isMac?'MetaLeft':'ControlLeft',modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers});
    await send('Input.dispatchKeyEvent', {type:'keyUp',key:isMac?'Meta':'Control',code:isMac?'MetaLeft':'ControlLeft',modifiers:0});
    await send('Input.insertText', {text:String(prompt||'')});
  });
  await sleep(700);
  const verify=await execMain('readEditor');
  if(!verify?.success) return {success:false,error:verify?.error||'Could not read Flow editor after native input'};
  const actual=String(verify.text||''), expected=String(prompt||'').trim();
  const ok=actual===expected||actual.includes(expected)||(expected.length>20&&actual.includes(expected.slice(0,60)));
  if(!ok) return {success:false,error:'Flow did not accept the native prompt input',actualText:actual.slice(0,240)};
  const button=await execMain('getSubmitTarget');
  if(!button?.success) return {success:false,error:button?.error||'Generate button not found after prompt verification'};
  const br=button.rect || {};
  // getSubmitTarget returns x/y/w/h; normalize defensively so NaN never reaches CDP.
  const bLeft = Number.isFinite(Number(br.left)) ? Number(br.left) : Number(br.x);
  const bTop = Number.isFinite(Number(br.top)) ? Number(br.top) : Number(br.y);
  const bWidth = Number.isFinite(Number(br.width)) ? Number(br.width) : Number(br.w);
  const bHeight = Number.isFinite(Number(br.height)) ? Number(br.height) : Number(br.h);
  if (![bLeft,bTop,bWidth,bHeight].every(Number.isFinite) || bWidth <= 0 || bHeight <= 0) {
    return {success:false,error:'Generate button coordinates are invalid',buttonRect:br};
  }
  const bx=Math.round(bLeft+bWidth/2),by=Math.round(bTop+bHeight/2);
  await withDebuggerSend(tabId,async send=>{
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:bx,y:by});
    await send('Input.dispatchMouseEvent', {type:'mousePressed',x:bx,y:by,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:bx,y:by,button:'left',clickCount:1});
  });
  return {success:true,method:'CDP-native-input-and-click',buttonLabel:button.label,actualText:actual.slice(0,240)};
}

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg.type==='PING'){sendResponse({pong:true});return false;}
  if(msg.type==='CHECK_CONNECTION'){inspectConnection().then(state=>sendResponse({state}));return true;}
  if(msg.type==='GET_FLOW_TAB'){getFlowTab().then(tab=>sendResponse({tab}));return true;}
  if(msg.type==='START_QUEUE'){
    getFlowTab().then(async tab=>{
      if(!tab){broadcast({type:'BATCH_ERROR',error:'Flow tab not found'});return;}
      const ok=await ensureContentScript(tab.id); if(!ok){broadcast({type:'BATCH_ERROR',error:'Could not connect to Flow page'});return;}
      runQueue(tab.id).catch(e=>broadcast({type:'BATCH_ERROR',error:String(e?.message||e)}));
    }); sendResponse({ok:true}); return false;
  }
  if(msg.type==='STOP_QUEUE'){stopFlag=true;if(currentFlowTabId)chrome.tabs.sendMessage(currentFlowTabId,{action:'stopProcessing'}).catch(()=>{});sendResponse({ok:true});return false;}
  if(msg.type==='GET_QUEUE'){loadQueue().then(queue=>sendResponse({queue}));return true;}
  if(msg.type==='SAVE_QUEUE'){saveQueue(msg.queue).then(()=>sendResponse({ok:true}));return true;}
  if(msg.type==='CLEAR_QUEUE'){storageRemove(QUEUE_KEY).then(()=>sendResponse({ok:true}));return true;}
  if(msg.type==='INSPECT_FLOW'){inspectConnection(msg.tabId).then(state=>sendResponse({state}));return true;}
  if(msg.type==='TEST_PROMPT'){
    getFlowTab().then(async tab=>{if(!tab){sendResponse({success:false,error:'Flow tab not found'});return;}await ensureContentScript(tab.id);const r=await sendToContent(tab.id,{action:'testPromptInsertion',prompt:msg.prompt||'FlowPix AI Test Prompt'},20000);sendResponse(r);});return true;
  }
  if(msg.action==='runMainWorldTask'){
    const tabId=sender.tab?.id;if(!tabId){sendResponse({success:false,error:'No tab ID'});return false;}
    if(msg.task==='nativeInsertOnly'){
      nativeInsertOnly(tabId,msg.args?.[0]||'').then(sendResponse).catch(e=>sendResponse({success:false,error:String(e?.message||e)}));
      return true;
    }
    if(msg.task==='nativeInsertAndClick'){
      nativeInsertAndClick(tabId,msg.args?.[0]||'').then(sendResponse).catch(e=>sendResponse({success:false,error:String(e?.message||e)}));
      return true;
    }
    const allowed=new Set(['inspectFlow','injectPrompt','clickSubmitAndVerify','waitForGenerationStart','waitForGenerationComplete','getEditorTarget','getSubmitTarget','readEditor']);
    if(!allowed.has(msg.task)){sendResponse({success:false,error:'Unknown task: '+msg.task});return false;}
    chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:flowMainTask,args:[msg.task,msg.args||[]]}).then(results=>sendResponse(results?.[0]?.result||{success:false,error:'No result'})).catch(e=>sendResponse({success:false,error:String(e?.message||e)}));
    return true;
  }
});
