/**
 * AI module map
 * Purpose: observe allowlisted platform requests as soon as the page receives authorization.
 * Entry: invitationObserver is serialized into the top MAIN world by scripting.executeScript.
 * Flow: fetch/XHR clones feed bounded redacted latest slots; snapshot is pulled by extension code.
 * State: per-document route revision and monotonically increasing request sequence reject stale results.
 * Boundary: MAIN data is untrusted. No postMessage, native bridge, requests or authorization capability.
 * Own-request signatures suppress runner replays without changing platform request results.
 */
export function invitationObserver(platform, action = 'install', payload = {}) {
  if (!['douyin', 'kuaishou'].includes(platform)) throw Error('未知平台')
  const key = '__DALANCHONG_INVITATION_OBSERVER__'
  const gate = globalThis.__dlcFeatureGate
  if (!gate?.active) throw Error('插件未激活或授权已失效')
  if (action !== 'install') {
    const existing = window[key]
    if (!existing || existing.platform !== platform) throw Error('当前页面尚未准备观察')
    return existing.access(action, payload)
  }
  if (window[key]) {
    if (window[key].platform !== platform) throw Error('页面平台不匹配')
    if (window[key].lifecycleEpoch === payload.lifecycleEpoch) return window[key].access('snapshot', {})
    window[key].access('dispose', {})
  }
  const origin = platform === 'kuaishou'
    ? 'https://cps.kwaixiaodian.com'
    : 'https://buyin.jinritemai.com'
  if (window.top !== window || location.origin !== origin) return
  const scope = gate.begin('invitation-observer')
  if (!scope) throw Error('观察器生命周期未就绪')
  const readers = new Set()
  const xhrListeners = new Set()
  scope.cleanup(() => {
    for (const reader of readers) void reader.cancel().catch(() => {})
    readers.clear()
    for (const {xhr, listener} of xhrListeners) xhr.removeEventListener('loadend', listener)
    xhrListeners.clear()
  })

  const paths = platform === 'kuaishou' ? {
    '/gateway/distribute/match/common/orchestration/execute': 'list',
    '/gateway/distribute/pc/common/promoter/list': 'list',
    '/distribute/pc/seller/promoter/list': 'list',
    '/distribute/pc/seller/promoter/search/list': 'list',
    '/gateway/distribute/platform/reco/promoter': 'list',
    '/gateway/distribute/platform/promoter/ranking/query': 'list',
    '/distribute/pc/seller/invite/contact': 'quota',
    '/gateway/distribute/match/user/basic/login/info': 'account',
  } : {
    '/square_pc_api/square/search_feed_author': 'list',
    '/square_pc_api/similar_kol/list': 'list',
    '/square_pc_api/prd_2_kol/list': 'list',
    '/square_pc_api/recommend/crowd_pack_rec_author': 'list',
    '/square_pc_api/selection_square_clue/list': 'list',
    '/square_pc_api/peer/shopPeerList': 'list',
    '/square_pc_api/peer/shopCollectList': 'list',
    '/square_pc_api/rank/author/list': 'list',
    '/connection/pc/im/shop_contact_rights_info': 'quota',
    '/index/getUser': 'account',
  }
  const observations = new Map()
  const documentId = crypto.randomUUID()
  const latest = new Map()
  const ownRequests = new Map()
  let pageUrl = location.href
  let routeRevision = 0
  const notifyRoute = () => {
    if (!scope.active || pageUrl === location.href) return
    pageUrl = location.href
    routeRevision += 1
    latest.clear()
    observations.clear()

  }
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    scope.patch(history, method, function () {
      const result = original.apply(this, arguments)
      notifyRoute()
      return result
    })
  }
  scope.listen(window, 'popstate', notifyRoute)
  scope.listen(window, 'hashchange', notifyRoute)
  const requestPage = () => {
    notifyRoute()
    return { pageUrl, routeRevision }
  }
  const listSupported = (path, body, url) => {
    const page = new URL(url)
    if (page.origin !== origin) return false
    if (platform === 'kuaishou') {
      if (page.pathname === '/zone/daren-match/daren-square-pro') {
        return path === '/distribute/pc/seller/promoter/list'
          || (path === '/distribute/pc/seller/promoter/search/list'
            && body?.sceneCode === 'ps_seller_search_promoter_list')
          || (path === '/gateway/distribute/platform/reco/promoter'
            && [
              'ps_reco_promoter_by_select_item',
              'ps_reco_promoter_by_select_promoter',
              'ps_reco_promoter_by_seller_channel',
              'ps_reco_promoter_by_relation_sameseller',
              'ps_reco_promoter_data_raise_up',
            ].includes(body?.sceneCode))
      }
      if (page.pathname === '/zone-cps/promoter-rank-list') {
        return path === '/gateway/distribute/platform/promoter/ranking/query'
      }
      return page.pathname === '/zone/daren-match/peer-reference'
        && ((path === '/gateway/distribute/match/common/orchestration/execute'
          && body?.scene === 'distribute_peer_seller_list')
          || (path === '/gateway/distribute/pc/common/promoter/list'
            && body?.sceneCode === 'ps_seller_coop_promoter_list'))
    }
    return (page.pathname === '/dashboard/servicehall/daren-square'
      && [
        '/square_pc_api/square/search_feed_author',
        '/square_pc_api/similar_kol/list',
        '/square_pc_api/prd_2_kol/list',
        '/square_pc_api/recommend/crowd_pack_rec_author',
      ].includes(path))
      || (page.pathname === '/dashboard/servicehall/clue-daren'
        && path === '/square_pc_api/selection_square_clue/list')
      || (page.pathname === '/dashboard/servicehall/peer-reference'
        && ['/square_pc_api/peer/shopPeerList', '/square_pc_api/peer/shopCollectList'].includes(path))
      || (page.pathname === '/dashboard/ranklist/daren'
        && path === '/square_pc_api/rank/author/list')
  }
  const maxBody = 2 * 1024 * 1024
  let sequence = 0
  const sensitive = /cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation/i
  const redactText = (text) => String(text).replace(
    /(["']?[\w-]*(?:cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation)[\w-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>&;]+)/gi,
    '$1[已隐藏]'
  )
  const redactValue = (key, item) =>
    sensitive.test(key) ? '[已隐藏]' : typeof item === 'string' ? redactText(item) : item
  const sanitize = (value) => JSON.parse(JSON.stringify(value, redactValue))
  const safeUrl = (value) => {
    const url = new URL(value, location.href)
    for (const key of [...url.searchParams.keys()]) {
      if (sensitive.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    url.username = ''
    url.password = ''
    return url.href
  }
  const signature = (path, body) => `${path.split('?')[0]}\n${JSON.stringify(body ?? null)}`
  // Observation failures are reported in the local UI; a failed IPC must never
  // change the return value or rejection of the platform's original request.
  const current = (request) => scope.active && request.pageUrl === location.href
    && request.routeRevision === routeRevision
    && latest.get(request.kind) === request.sequence
  const report = payload => {
    if (current(payload.request)) observations.set(payload.request.kind, payload)
  }
  const fail = (request, error) => {
    if (current(request)) report({
      request: { ...request, phase: 'complete' },
      error: redactText(error.message || error).slice(0, 8000),
    })
  }
  // The pending event invalidates older observations immediately; only the matching
  // completion may establish a new active filter. App-owned calls are excluded by signature.
  const begin = (value, method, rawBody, order, page) => {
    if (!scope.active || page.pageUrl !== location.href || page.routeRevision !== routeRevision) return null
    const url = new URL(value, page.pageUrl)
    const kind = url.origin === origin && paths[url.pathname]
    if (!kind || method === 'OPTIONS') return null
    if (platform === 'kuaishou' && kind === 'quota' && url.searchParams.get('inviteType') !== '1') return null
    let body = rawBody ?? null
    if (body !== null && typeof body !== 'string' && (typeof body !== 'object' || Object.getPrototypeOf(body) !== Object.prototype)) return null
    if (typeof body === 'string') {
      if (body.length > maxBody) return null
      try { body = body ? JSON.parse(body) : null } catch { return null }
    }
    if (JSON.stringify(body).length > maxBody) return null
    if (kind === 'list' && !listSupported(url.pathname, body, page.pageUrl)) return null
    if (ownRequests.has(signature(url.pathname, body))) return null
    const request = {
      kind, path: url.pathname, url: safeUrl(url.href), method,
      body: sanitize(body), sequence: order, documentId, ...page,
    }
    if ((latest.get(kind) || 0) >= request.sequence) return null
    latest.set(kind, request.sequence)
    report({ request: { ...request, phase: 'pending' } })
    return request
  }
  const finish = (request, text, metadata) => {
    if (!current(request)) return
    if (text.length > maxBody) {
      fail(request, Error('网页响应超过 2 MiB，未读取完整列表'))
      return
    }
    let safeText
    try { safeText = JSON.stringify(JSON.parse(text), redactValue) }
    catch { safeText = redactText(text).slice(0, 8000) }
    report({
      request: { ...request, phase: 'complete' },
      response: { ...metadata, url: safeUrl(metadata.url), text: safeText, observedAt: Date.now() },
    })
  }
  const readText = async (response, request) => {
    if (!response.body) return ''
    const reader = response.body.getReader()
    readers.add(reader)
    try {
      const decoder = new TextDecoder()
      let length = 0
      let text = ''
      while (true) {
        if (!current(request)) {
          void reader.cancel()
          return null
        }
        const { done, value } = await reader.read()
        if (!current(request)) return null
        if (done) return text + decoder.decode()
        length += value.byteLength
        if (length > maxBody) {
          void reader.cancel()
          throw Error('网页响应超过 2 MiB，未读取完整列表')
        }
        text += decoder.decode(value, { stream: true })
      }
    } finally { readers.delete(reader) }
  }
  const readRequestBody = async request => {
    const reader = request.body?.getReader()
    if (!reader) return null
    readers.add(reader)
    try {
      let size = 0, text = ''
      const decoder = new TextDecoder()
      while (true) {
        if (!scope.active) { void reader.cancel().catch(() => {}); return null }
        const {done, value} = await reader.read()
        if (!scope.active) return null
        if (done) return text + decoder.decode()
        size += value.byteLength
        if (size > maxBody) { void reader.cancel(); throw Error('请求体超过 2 MiB') }
        text += decoder.decode(value, {stream: true})
      }
    } finally { readers.delete(reader) }
  }
  const originalFetch = window.fetch
  scope.patch(window, 'fetch', function (input, init) {
    if (!scope.active) return originalFetch.apply(this, arguments)
    const isRequest = input instanceof Request
    const url = isRequest ? input.url : String(input)
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase()
    let parsed
    try { parsed = new URL(url, location.href) } catch { return originalFetch.apply(this, arguments) }
    if (parsed.origin !== origin || !paths[parsed.pathname] || method === 'OPTIONS')
      return originalFetch.apply(this, arguments)
    const order = ++sequence
    const page = requestPage()
    // Clone Request bodies before dispatch, but do not await observation before fetch.
    const body = init?.body !== undefined ? Promise.resolve(init.body)
      : isRequest && method !== 'GET' && method !== 'HEAD' ? readRequestBody(input.clone())
      : Promise.resolve(null)
    let request
    const observed = body.then((value) => {
      try { request = begin(url, method, value, order, page) } catch { request = null }
      return request
    }).catch(() => null)
    const result = originalFetch.apply(this, arguments)
    void result.then(async (response) => {
      // App-owned and superseded requests do not need a second response stream.
      if (!scope.active || request === null || (request && !current(request))) return
      // Clone immediately, before the platform consumes the original response.
      const copy = response.clone()
      const captured = await observed
      if (!captured || !current(captured)) {
        if (copy.body) void copy.body.cancel()
        return
      }
      try {
        const text = await readText(copy, captured)
        if (text === null) return
        finish(captured, text, {
          status: response.status, url: response.url || url,
          requestId: response.headers.get('x-tt-logid') ||
            response.headers.get('x-request-id') || response.headers.get('request-id') || '',
        })
      } catch (error) { fail(captured, error) }
    }, async (error) => {
      const captured = await observed
      if (captured) fail(captured, error)
    }).catch(() => {})
    return result
  })

  const xhrMeta = new WeakMap()
  const xhrOpen = XMLHttpRequest.prototype.open
  const xhrSend = XMLHttpRequest.prototype.send
  scope.patch(XMLHttpRequest.prototype, 'open', function (method, url) {
    const result = xhrOpen.apply(this, arguments)
    if (scope.active) xhrMeta.set(this, { method: String(method).toUpperCase(), url: String(url) })
    return result
  })
  scope.patch(XMLHttpRequest.prototype, 'send', function (body) {
    if (!scope.active) return xhrSend.apply(this, arguments)
    const meta = xhrMeta.get(this)
    let request
    try { request = meta && begin(meta.url, meta.method, body, ++sequence, requestPage()) } catch {}
    if (request) {
      const binding = {xhr: this, listener: null}
      binding.listener = () => {
        xhrListeners.delete(binding)
        try {
        if (!current(request)) return
        if (!this.status) {
          fail(request, Error('网页请求失败或已取消'))
          return
        }
        const text = this.responseType === 'json' ? JSON.stringify(this.response)
          : this.responseType === '' || this.responseType === 'text' ? this.responseText : null
        if (text === null) {
          fail(request, Error('网页接口返回了非文本响应'))
          return
        }
        finish(request, text, {
          status: this.status, url: this.responseURL || meta.url,
          requestId: this.getResponseHeader('x-tt-logid') ||
            this.getResponseHeader('x-request-id') || this.getResponseHeader('request-id') || '',
        })
        } catch (error) { fail(request, error) }
      }
      xhrListeners.add(binding)
      this.addEventListener('loadend', binding.listener, {once: true})
    }
    return xhrSend.apply(this, arguments)
  })

  const handles = new Map()
  const access = (operation, value) => {
    scope.assert()
    notifyRoute()
    if (value.expected && (value.expected.documentId !== documentId ||
        value.expected.pageUrl !== pageUrl || value.expected.routeRevision !== routeRevision))
      throw Error('来源路由已改变，请重新准备')
    if (operation === 'dispose') { scope.stop(); return null }
    if (operation === 'snapshot') return {
      documentId, pageUrl, routeRevision, observations: [...observations.values()],
    }
    if (operation === 'identity') return {
      documentId, pageUrl, routeRevision,
      observations: observations.has('account') ? [observations.get('account')] : [],
    }
    if (operation === 'markOwn') {
      const path = new URL(value.path, origin)
      if (path.origin !== origin || !paths[path.pathname]) throw Error('非观察接口')
      const handle = crypto.randomUUID()
      const body = typeof value.body === 'string' ? JSON.parse(value.body || 'null') : value.body
      const sig = signature(path.pathname, body)
      handles.set(handle, sig)
      ownRequests.set(sig, (ownRequests.get(sig) || 0) + 1)
      return handle
    }
    if (operation === 'releaseOwn') {
      const sig = handles.get(value.handle)
      if (sig) {
        handles.delete(value.handle)
        const count = ownRequests.get(sig) - 1
        if (count) ownRequests.set(sig, count)
        else ownRequests.delete(sig)
      }
      return null
    }
    throw Error('不支持的观察操作')
  }
  const owner = Object.freeze({platform, access, lifecycleEpoch: payload.lifecycleEpoch})
  Object.defineProperty(window, key, {value: owner, configurable: true})
  scope.cleanup(() => {
    observations.clear(); latest.clear(); ownRequests.clear(); handles.clear()
    if (window[key] === owner) delete window[key]
  })
  return access('snapshot', {})
}
