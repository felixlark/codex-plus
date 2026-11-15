// Runs only in the existing preload isolated context of the owned blank frame.
export function installMobileGitOriginRepair(nonce, instance) {
  const owned = () => location.href === 'about:blank' && location.origin === 'null' &&
    document.querySelector('meta[name="codex-plus-mobile-anchor"]')?.content === nonce &&
    document.querySelector('meta[name="codex-plus-mobile-instance"]')?.content === instance &&
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content === "default-src 'none'" &&
    !document.querySelector('script');
  if (!owned()) return false;
  const previous = globalThis.__codexPlusMobileGitOriginRepair;
  if (previous) return previous.nonce === nonce && previous.instance === instance && window.postMessage === previous.post;
  const original = window.postMessage;
  function post(message, target, transfer) {
    const keys = message && typeof message === 'object' ? Object.keys(message) : [];
    const metadata = keys.length === 3 && keys.every(key => ['type', 'requestId', 'closed'].includes(key)) &&
      message.type === 'codex_desktop:git-worker-port' && typeof message.requestId === 'string' && message.requestId.length > 0;
    const ports = Array.isArray(transfer) && (message?.closed === undefined && transfer.length === 1 && transfer[0] instanceof MessagePort ||
      message?.closed === true && transfer.length === 0);
    if (this === window && arguments.length === 3 && target === 'null' && metadata && ports && owned()) {
      // The original preload addresses this same, script-free opaque window.
      // Keep its payload and real ports; repair only the invalid target string.
      return Reflect.apply(original, window, [message, '*', transfer]);
    }
    return Reflect.apply(original, this, arguments);
  }
  window.postMessage = post;
  globalThis.__codexPlusMobileGitOriginRepair = {nonce, instance, post, close() {
    if (window.postMessage === post) window.postMessage = original;
    if (globalThis.__codexPlusMobileGitOriginRepair?.post === post) delete globalThis.__codexPlusMobileGitOriginRepair;
  }};
  return window.postMessage === post;
}
