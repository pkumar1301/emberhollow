const RaidClient = (() => {
  let worker;
  let nextId = 0;
  const pending = new Map();

  function stop(error) {
    worker?.terminate();
    worker = undefined;
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  }

  function connect() {
    const instance = new Worker('raid-worker.js');
    instance.addEventListener('message', ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timeout);
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    });
    instance.addEventListener('error', event => {
      if (worker === instance) stop(new Error(event.message || 'Raid worker failed'));
    });
    return instance;
  }

  function request(action, snapshot) {
    return new Promise((resolve, reject) => {
      worker ??= connect();
      const id = ++nextId;
      const timeout = setTimeout(() => stop(new Error('Raid engine timed out')), 45000);
      pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ id, action, snapshot });
    });
  }

  return { request };
})();
