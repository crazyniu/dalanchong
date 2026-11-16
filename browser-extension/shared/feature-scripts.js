/** Licensed injection inventory; source paths and match rules remain explicit. */
export const featureScripts = [
  {
    matches: ["https://buyin.jinritemai.com/*", "https://cps.kwaixiaodian.com/*"],
    js: ["content/feature-gate.js"],
    world: "MAIN",
    id: "licensed-invite-observer",
    runAt: "document_start",
    allFrames: false
  },
  {
    "matches": [
      "http://*/*",
      "https://*/*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/capture.js"
    ],
    "id": "licensed-feature-0",
    "runAt": "document_idle",
    "allFrames": true,
    "matchAboutBlank": true
  },
  {
    "matches": [
      "https://compass.jinritemai.com/talent/video-rank*",
      "https://compass.jinritemai.com/talent/product-rank*",
      "https://compass.jinritemai.com/shop/chance/video-rank*",
      "https://compass.jinritemai.com/shop/chance/video-talent-rank*",
      "https://compass.jinritemai.com/shop/chance/product-rank*",
      "https://compass.jinritemai.com/shop/chance/merchandise-product-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-product*",
      "https://compass.jinritemai.com/shop/chance/rank-product/detail*",
      "https://compass.jinritemai.com/shop/chance/live-talent-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-talent*",
      "https://compass.jinritemai.com/shop/chance/rank-video*",
      "https://compass.jinritemai.com/shop/chance/search-rank-product*",
      "https://compass.jinritemai.com/shop/chance/search-product-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-video/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-shop/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-live/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-live*",
      "https://compass.jinritemai.com/shop/chance*",
      "https://buyin.jinritemai.com/dashboard/merch-picking-library/merch-promoting*",
      "https://buyin.jinritemai.com/pc/selection/decision/pack_detail*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/content.js"
    ],
    "css": [
      "content/commerce-ui.css"
    ],
    "id": "licensed-feature-2",
    "runAt": "document_start",
    "allFrames": true
  },
  {
    "matches": [
      "https://compass.jinritemai.com/talent/video-rank*",
      "https://compass.jinritemai.com/talent/product-rank*",
      "https://compass.jinritemai.com/shop/chance/video-rank*",
      "https://compass.jinritemai.com/shop/chance/video-talent-rank*",
      "https://compass.jinritemai.com/shop/chance/product-rank*",
      "https://compass.jinritemai.com/shop/chance/merchandise-product-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-product*",
      "https://compass.jinritemai.com/shop/chance/rank-product/detail*",
      "https://compass.jinritemai.com/shop/chance/live-talent-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-talent*",
      "https://compass.jinritemai.com/shop/chance/rank-video*",
      "https://compass.jinritemai.com/shop/chance/search-rank-product*",
      "https://compass.jinritemai.com/shop/chance/search-product-rank*",
      "https://compass.jinritemai.com/shop/chance/rank-video/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-shop/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-live/detail*",
      "https://compass.jinritemai.com/shop/chance/rank-live*",
      "https://compass.jinritemai.com/shop/chance*",
      "https://buyin.jinritemai.com/dashboard/merch-picking-library/merch-promoting*",
      "https://buyin.jinritemai.com/pc/selection/decision/pack_detail*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/xhr.js"
    ],
    "world": "MAIN",
    "id": "licensed-feature-3",
    "runAt": "document_start",
    "allFrames": true
  },
  {
    "matches": [
      "https://www.douyin.com/*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/page.js"
    ],
    "world": "MAIN",
    "id": "licensed-feature-4",
    "runAt": "document_start",
    "allFrames": false
  },
  {
    "matches": [
      "https://www.kuaishou.com/*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/detail-page.js"
    ],
    "world": "MAIN",
    "id": "licensed-feature-5",
    "runAt": "document_start",
    "allFrames": false
  },
  {
    "matches": [
      "https://www.douyin.com/*",
      "https://www.kuaishou.com/*"
    ],
    "js": [
      "content/feature-gate.js",
      "content/detail-buttons.js"
    ],
    "id": "licensed-feature-6",
    "runAt": "document_idle",
    "allFrames": false
  },
  {
    matches: ["https://buyin.jinritemai.com/*", "https://cps.kwaixiaodian.com/*"],
    js: ["content/feature-gate.js", "invitation/content/invitation-host.js", "invitation/content/invite-return.js"],
    id: "licensed-invite-toolbar",
    runAt: "document_idle",
    allFrames: false
  }
];
