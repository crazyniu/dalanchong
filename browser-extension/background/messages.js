/** Dispatch fixed video actions from this extension's own pages and content scripts. */
export function listenMessages(types, handler) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !types.has(message?.type)) return;
    try { handler(message, sender, respond); }
    catch (error) { respond({ok: false, success: false, error: error.message}); }
    return true;
  });
}
