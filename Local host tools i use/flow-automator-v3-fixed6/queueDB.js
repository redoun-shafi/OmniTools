// queueDB.js — IndexedDB task queue (no auth, no subscription)

const DB_NAME = "FlowAutomatorDB";
const STORE_NAME = "tasks";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("order", "order");
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function loadQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index("order").getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveQueue(tasks) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tasks.forEach((t, i) => store.put({ ...t, order: i }));
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function addTask(task) {
  const tasks = await loadQueue();
  const newTask = { ...task, id: crypto.randomUUID(), status: "pending", order: tasks.length };
  tasks.push(newTask);
  await saveQueue(tasks);
  return newTask;
}

export async function addTasks(newTasks) {
  const tasks = await loadQueue();
  const added = newTasks.map((t, i) => ({
    ...t, id: crypto.randomUUID(), status: "pending", order: tasks.length + i
  }));
  await saveQueue([...tasks, ...added]);
  return added;
}

export async function removeTask(id) {
  const tasks = await loadQueue();
  await saveQueue(tasks.filter(t => t.id !== id));
}

export async function updateTask(id, changes) {
  const tasks = await loadQueue();
  await saveQueue(tasks.map(t => t.id === id ? { ...t, ...changes } : t));
}

export async function clearQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getTaskById(id) {
  const tasks = await loadQueue();
  return tasks.find(t => t.id === id) || null;
}

export async function getNextPendingTask() {
  const tasks = await loadQueue();
  return tasks.find(t => t.status === "pending") || null;
}

export async function markTaskAsCurrent(id) {
  await updateTask(id, { status: "processing" });
}

export async function markTaskAsProcessed(id) {
  await updateTask(id, { status: "done" });
}

export async function resetProcessedTasks() {
  const tasks = await loadQueue();
  await saveQueue(tasks.map(t => ({ ...t, status: "pending" })));
}

export async function getQueueStats() {
  const tasks = await loadQueue();
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === "pending").length,
    processing: tasks.filter(t => t.status === "processing").length,
    done: tasks.filter(t => t.status === "done").length,
  };
}
