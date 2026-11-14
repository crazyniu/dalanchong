/** Per-document lifecycle for licensed features. Never enables via page messages. */
(() => {
  if (globalThis.__dlcFeatureGate?.active) return;
  const scopes = new Map();
  let active = true;
  const gate = {
    get active() { return active; },
    stop() {
      if (!active) return;
      active = false;
      for (const scope of scopes.values()) scope.stop();
      scopes.clear();
    },
    begin(name) {
      if (!active || scopes.has(name)) return null;
      let running = true;
      const cleanup = new Set();
      const eventBindings = new Set();
      const scope = {
        get active() { return active && running; },
        assert() { if (!scope.active) throw new Error('插件未激活或授权已失效'); },
        cleanup(fn) { if (scope.active) cleanup.add(fn); else fn(); },
        stop() {
          if (!running) return;
          running = false;
          for (const fn of cleanup) { try { fn(); } catch {} }
          cleanup.clear();
          eventBindings.clear();
        },
        listen(target, type, fn, options) {
          if (!scope.active) return;
          const wrapped = function (...args) { if (scope.active) return fn.apply(this, args); };
          const binding = {target, type, fn, options, wrapped};
          eventBindings.add(binding);
          target.addEventListener(type, wrapped, options);
          scope.cleanup(() => target.removeEventListener(type, wrapped, options));
        },
        unlisten(target, type, fn, options) {
          for (const binding of eventBindings) {
            if (binding.target === target && binding.type === type && binding.fn === fn) {
              target.removeEventListener(type, binding.wrapped, binding.options);
              eventBindings.delete(binding);
            }
          }
        },
        chromeListen(event, fn) {
          if (!scope.active) return;
          const wrapped = (...args) => { if (scope.active) return fn(...args); };
          event.addListener(wrapped);
          scope.cleanup(() => event.removeListener(wrapped));
        },
        createElement(...args) {
          scope.assert();
          const node = document.createElement(...args);
          scope.cleanup(() => node.remove());
          return node;
        },
        setTimeout(fn, delay, ...args) {
          if (!scope.active) return;
          let undo;
          const id = globalThis.setTimeout(() => {
            cleanup.delete(undo);
            if (scope.active) fn(...args);
          }, delay);
          undo = () => globalThis.clearTimeout(id);
          cleanup.add(undo);
          return id;
        },
        setInterval(fn, delay, ...args) {
          if (!scope.active) return;
          const id = globalThis.setInterval(() => { if (scope.active) fn(...args); }, delay);
          scope.cleanup(() => globalThis.clearInterval(id));
          return id;
        },
        patch(object, key, replacement) {
          const original = object[key];
          object[key] = replacement;
          // Do not undo a newer hook installed by the page or another extension.
          scope.cleanup(() => { if (object[key] === replacement) object[key] = original; });
        },
      };
      scope.MutationObserver = class extends globalThis.MutationObserver {
        constructor(fn) {
          super((...args) => { if (scope.active) fn(...args); });
          scope.cleanup(() => this.disconnect());
        }
      };
      scopes.set(name, scope);
      return scope;
    }
  };
  globalThis.__dlcFeatureGate = gate;
  // Only the extension worker can revoke isolated-world features. No message enables them.
  if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime.onMessage) {
    const changed = (message, sender) => {
      if (sender.id === chrome.runtime.id && message?.type === 'LICENSE_CHANGED' && !message.license?.valid) {
        gate.stop();
      }
    };
    chrome.runtime.onMessage.addListener(changed);
    const stop = gate.stop;
    gate.stop = () => { stop(); chrome.runtime.onMessage.removeListener(changed); };
  }
})();
