/** Per-document lifecycle for video UI, observers, timers and page hooks. */
(() => {
  if (globalThis.__dlcPageScopes) return;
  const scopes = new Map();
  const pageScopes = {
    begin(name) {
      if (scopes.has(name)) return null;
      let running = true;
      const cleanup = new Set();
      const eventBindings = new Set();
      const scope = {
        get active() { return running; },
        assert() { if (!scope.active) throw new Error('页面操作已停止'); },
        cleanup(fn) { if (scope.active) cleanup.add(fn); else fn(); },
        stop() {
          if (!running) return;
          running = false;
          for (const fn of cleanup) { try { fn(); } catch {} }
          cleanup.clear();
          eventBindings.clear();
          if (scopes.get(name) === scope) scopes.delete(name);
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
  globalThis.__dlcPageScopes = pageScopes;
})();
