/** Open the video workspace from the browser's context menu. */
const menuId = 'dalanchong-video';

export function createContextMenuController({menus, tabs, runtime}) {
  let initialized;
  const callbackCall = (method, ...args) => new Promise((resolve, reject) => {
    method(...args, () => {
      const error = runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  });
  async function rebuild() {
    await callbackCall(menus.removeAll.bind(menus));
    await callbackCall(menus.create.bind(menus), {id: menuId, title: '视频工作区', contexts: ['all']});
  }
  async function click(info) {
    if (info.menuItemId !== menuId) return;
    return tabs.create({url: runtime.getURL('manager.html?view=captured')});
  }
  function initialize() {
    if (!initialized) {
      menus.onClicked.addListener(info => {
        void click(info).catch(error => console.error('打开视频工作区失败', error.message));
      });
      initialized = rebuild();
    }
    return initialized;
  }
  return {initialize, rebuild, click};
}

let controller;
export function initializeContextMenus() {
  controller ||= createContextMenuController({menus: chrome.contextMenus, tabs: chrome.tabs, runtime: chrome.runtime});
  return controller.initialize();
}
