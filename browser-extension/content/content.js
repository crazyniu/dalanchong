
(() => {
  const scope = globalThis.__dlcPageScopes?.begin('content');
  if (!scope) return;
  const {setTimeout, setInterval, MutationObserver} = scope;
/**
 * AI module map
 * Purpose: isolated-world bridge for the supported commerce pages and frames.
 * Entry: page message events from xhr.js and runtime messages from commerce-background.js.
 * Flow: forward tab/download requests to Chrome, return download acknowledgements
 * to the same source page. No page-triggered storage debugging commands are exposed.
 * State: downloadedVideos belongs to chrome.storage.local; this bridge owns no cache.
 * Boundary: preserve message types and payloads across the page/extension realms;
 * a successful download response acknowledges task creation, not file completion.
 */

scope.listen(window, 'message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const message = event.data
  if (!message || typeof message !== 'object') return

  if (message.type === 'OPEN_TAB') {
    let url
    try { url = new URL(message.url) } catch { return }
    if (!['http:', 'https:'].includes(url.protocol)) return
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: url.href })
  } else if (message.type === 'DOWNLOAD_FILE_REQUEST') {
    console.log(
      'Content script收到下载请求: ' + message.filename + ' 到文件夹: '
        + message.folderName + ' (第 ' + (message.attempt || 1) + ' 次尝试)'
    )
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: message.url,
      filename: message.filename,
      folderName: message.folderName,
      attempt: message.attempt || 1,
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Chrome连接错误:', chrome.runtime.lastError)
        window.postMessage({
          type: 'DOWNLOAD_FILE_RESPONSE',
          success: false,
          error: 'Chrome连接错误: ' + chrome.runtime.lastError.message,
          filename: message.filename,
        }, '*')
        return
      }

      window.postMessage({
        type: 'DOWNLOAD_FILE_RESPONSE',
        success: !!response && response.success,
        error: response ? response.error : 'No response',
        filename: message.filename,
      }, '*')
    })
  }
})

scope.chromeListen(chrome.runtime.onMessage, (message) => {
  if (message.type === 'VIDEO_OPENED_TO_CONTENT') {
    window.postMessage({ type: 'VIDEO_OPENED_TO_FINAL', url: message.url }, '*')
  }
})

})();
