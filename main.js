const electron = require('electron');
const app = electron.app;
const ipc = electron.ipcMain;
const dialog = electron.dialog;
const globalShortcut = electron.globalShortcut;
const Menu = electron.Menu;
const screen = electron.screen;
const session = electron.session;
const utils = require('./js/utils.js');

// 保留旧版渲染进程架构的兼容设置。窗口与系统 API 均通过 IPC 调用，
// 不再依赖已从 Electron 移除的 remote 模块。
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = true;

const platform = process.platform.startsWith('win') ? 'win' : process.platform;

// handle uncaught exception
process.on('uncaughtException', (err) => {
  console.error('主线程意外报错', err);
  utils.error(`主线程意外报错\n${err}`);
  dialog.showErrorBox('肥肠抱歉', 
    '好像似乎也许可能出现了意料之外的错误，我建议您现在关闭程序并到bilimini的根目录下找到一个名为bilimini.log的文件，并把这个文件通过电子邮件发送给我：i@thec.me。\n这份文件会帮助我了解您的程序在进行什么操作时出现了问题，因此它会包含您最近一次运行bilimini的浏览记录，如果您介意也可以选择不发送。_(:з」∠)_');
});

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically hen the JavaScript object is garbage collected.
var mainWindow = null, mainWindowIsClosed = null;
function openMainWindow() {
  utils.log('主窗口：开始创建');
  if( mainWindow ) {
    utils.log('主窗口：检测到主窗口已存在，正在关闭她');
    mainWindow.close();
    utils.log('主窗口：原主窗口已关闭');
  }
  // 根据透明度设置决定是否要创建transparent窗口
  // 不论在windows还是在mac下，正常窗口都会比transparent窗口多一个好看的阴影
  // 所以我们不希望为了方便始终使用transparent
  const storedOpacity = Number(utils.config.get('opacity'));
  // 迁移旧的完全不透明配置，让应用从首次启动起始终使用透明窗口模式。
  const opacity = Math.min(storedOpacity, 0.9999);
  if( storedOpacity !== opacity ) {
    utils.config.set('opacity', opacity);
  }
  var windowParams = {width: 375, height: 500, frame: false};
  if( opacity < 1 ) {
    windowParams.transparent = true;
    windowParams.opacity = opacity;
  }
  // 新增两个参数，第一是electron 5.0的安全性要求 ↓
  // https://www.electronjs.org/docs/tutorial/security#2-do-not-enable-nodejs-integration-for-remote-content
  // 但是这个参数对架构改动实在太大了，根本不想改。而且bilimini限制了代码只访问b站域名的内容，大体上不会有太多安全问题，所以直接把这个安全要求忽略掉了
  // 第二个参数是webview在5.0里默认被禁用了，又是个breaking change。。我人都傻了
  windowParams.webPreferences = {
    nodeIntegration: true,
    webviewTag: true,
    // 现有渲染层直接使用 CommonJS 模块。迁移到 preload/contextBridge 前，
    // 必须显式保留旧行为；remote 已替换为受控 IPC。
    contextIsolation: false,
    sandbox: false
  }
  mainWindow = new electron.BrowserWindow(windowParams);
  // Electron 22+ 不再推荐 webview 的 new-window 事件。B 站桌面首页的
  // 视频卡片大多使用 target=_blank，在这里拦截后交回主窗口路由打开。
  mainWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
    guestWebContents.setWindowOpenHandler(({ url }) => {
      if( /^https?:\/\//i.test(url) && !/bilibili\.com\/blackboard\/fe\/activity-/i.test(url) ) {
        mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('webview-open-url', url);
      } else {
        utils.log(`忽略 webview 弹窗：${url}`);
      }
      return { action: 'deny' };
    });
  });
  mainWindow.loadURL('file://' + __dirname + '/index.html');
  mainWindow.setAlwaysOnTop(true, 'torn-off-menu');
  mainWindow.on('closed', () => {
    mainWindow = null;
    utils.log('主窗口：已关闭');
    // 主窗口关闭后如果3s都没有重新创建，就认为程序是被不正常退出了（例如windows下直接alt+f4），关闭整个程序
    if( platform != 'darwin' ) {
      mainWindowIsClosed = setTimeout(() => {
        utils.log('主窗口：关闭超过 3s 未重新创建，程序自动退出');
        app.quit();
      }, 3000);
    }
  });
  mainWindow.on('hide', () => {
    if( utils.config.get('autoPause') ) {
      mainWindow.webContents.send('set-auto-playback', false);
    }
  });
  mainWindow.on('show', () => {
    if( utils.config.get('autoPause') ) {
      mainWindow.webContents.send('set-auto-playback', true);
    }
  });
  clearTimeout(mainWindowIsClosed);
  utils.log('主窗口：已创建');
  // mainWindow.webContents.openDevTools();
}

function initMainWindow() {
  ipc.on('recreate-main-window', (ev, opacity) => {
    if( Number.isFinite(Number(opacity)) ) {
      utils.config.set('opacity', Number(opacity));
    }
    openMainWindow();
  });
  ipc.on('close-main-window', () => {
    if( platform == 'darwin' ) {
      mainWindow && !mainWindow.isDestroyed() && mainWindow.close();
      selectPartWindow && !selectPartWindow.isDestroyed() && selectPartWindow.hide();
      configWindow && !configWindow.isDestroyed() && configWindow.hide();
    } else {
      app.quit();
    }
  });
  openMainWindow();
}

// 初始化选分p窗口
var selectPartWindow = null;
function initSelectPartWindow() {
  utils.log('选p窗口：开始创建');
  selectPartWindow = new electron.BrowserWindow({
    width: 200, height: 300, frame: false, show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });
  selectPartWindow.loadURL('file://' + __dirname + '/selectP.html');
  selectPartWindow.setAlwaysOnTop(true, 'modal-panel');
  selectPartWindow.on('closed', () => {
    selectPartWindow = null;
    utils.log('选p窗口：已关闭');
  });
  utils.log('选p窗口：已创建');
  // 切换、可开可关
  ipc.on('toggle-select-part-window', () => {
    if( selectPartWindow && selectPartWindow.isVisible() ) {
      selectPartWindow.hide();
    } else {
      showSelectPartWindow();
    }
  });
  // 仅开启
  ipc.on('show-select-part-window', showSelectPartWindow);
  // selectPartWindow.openDevTools();
}

function showSelectPartWindow() {
  utils.log('选p窗口：打开');
  if( !mainWindow || !selectPartWindow ) {
    return;
  }
  var p = mainWindow.getPosition(), s = mainWindow.getSize(),
      pos = [p[0] + s[0] + 10, p[1]];
  selectPartWindow.setPosition(pos[0], pos[1]);
  selectPartWindow.show();
}

// 初始化设置窗口
var configWindow = null;
function initConfigWindow() {
  utils.log('设置窗口：开始创建');
  configWindow = new electron.BrowserWindow({
    width: 200, height: 610, frame: false, show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });
  configWindow.loadURL('file://' + __dirname + '/config.html');
  configWindow.setAlwaysOnTop(true, 'modal-panel');
  configWindow.on('closed', () => {
    configWindow = null;
    utils.log('设置窗口：已关闭');
  });
  utils.log('设置窗口：已创建');
  // 切换、可开可关
  ipc.on('toggle-config-window', () => {
    if( configWindow && configWindow.isVisible() ) {
      configWindow.hide();
    } else {
      showConfigWindow();
    }
  });
  // 仅开启
  ipc.on('show-config-window', showConfigWindow);
  // configWindow.openDevTools();
}

function showConfigWindow() {
  utils.log('设置窗口：打开');
  if( !mainWindow || !configWindow ) {
    return;
  }
  var p = mainWindow.getPosition(), s = configWindow.getSize(),
      pos = [p[0] - s[0] - 10, p[1]];
  configWindow.setPosition(pos[0], pos[1]);
  configWindow.show();
}

function initExchangeMessageForRenderers() {
  // 转发分p数据，真的只能用这么蠢的方法实现么。。。
  ipc.on('update-part', (ev, args) => {
    if( !args && selectPartWindow && selectPartWindow.isVisible() ) {
      selectPartWindow.hide();
    } else {
      selectPartWindow && selectPartWindow.webContents.send('update-part', args);
    }
  });
  // 转发番剧分p消息，这俩的格式是不一样的，番剧的分p里带了playurl
  ipc.on('update-bangumi-part', (ev, args) => {
    selectPartWindow && selectPartWindow.webContents.send('update-bangumi-part', args);
  });
  // 转发当前webview的url地址给分p页面，方便分p页面判断当前位置
  ipc.on('url-changed', (ev, args) => {
    selectPartWindow && selectPartWindow.webContents.send('url-changed', args);
  });
  // 转发选p消息
  ipc.on('select-part', (ev, args) => {
    mainWindow && mainWindow.webContents.send('select-part', args);
  });
  // 番剧选P
  ipc.on('select-bangumi-part', (ev, args) => {
    mainWindow && mainWindow.webContents.send('select-bangumi-part', args);
  });
  // 设置主窗口透明度
  ipc.on('set-opacity', (ev, opacity) => {
    const value = Number(opacity);
    if( Number.isFinite(value) ) {
      utils.config.set('opacity', value);
      mainWindow && mainWindow.setOpacity(value);
    }
  });
}

// 当主窗口收到各种消息时的反应
function initActionOnMessage() {
  // mainWindow在default/mini尺寸间切换时同时移动selectPartWindow
  ipc.on('main-window-resized', (ev, pos, size) => {
    if( selectPartWindow.isVisible() ) {
      showSelectPartWindow();
    }
    if( configWindow.isVisible() ) {
      showConfigWindow();
    }
  });
  // 用户设置proxy时更新session代理
  ipc.on('set-proxy', () => {
    setProxy(true);
  });
  // electron-store 在不同进程中各自缓存数据；设置变更必须同步给主进程。
  ipc.on('set-auto-pause', (ev, autoPause) => {
    utils.config.set('autoPause', Boolean(autoPause));
  });
}

// 更新webview代理设置
async function setProxy(isUpdate) {
  var proxy = utils.config.get('proxy');
  // 如果是用户手动设置代理，那么要允许用户通过设置空白代理来删除代理，反之当初始化时忽略空白代理
  if( proxy == '' && !isUpdate ) {
    return false;
  }
  utils.log(`代理：设置代理 ${proxy}, isUpdate：${!!isUpdate}`);
  if( mainWindow ) {
    try {
      await mainWindow.webContents.session.setProxy({ proxyRules: proxy });
      if( isUpdate ) {
        await dialog.showMessageBox({
          message: '设置代理成功'
        });
      }
      utils.log('代理：设置成功');
    } catch (err) {
      utils.error(`代理：设置失败\\n${err}`);
      if( isUpdate ) {
        dialog.showErrorBox('设置代理失败', String(err));
      }
    }
  }
}

function initRendererIpc() {
  // 配置统一存放在主进程：electron-store 12 是 ESM-only，且这种方式也避免
  // 多个渲染进程各自缓存同一份配置。
  ipc.on('config-get', (event, key) => {
    event.returnValue = utils.config.get(key);
  });
  ipc.on('config-set', (event, key, value) => {
    utils.config.set(key, value);
    event.returnValue = true;
  });
  ipc.on('config-delete', (event, key) => {
    utils.config.delete(key);
    event.returnValue = true;
  });
  ipc.on('write-log', (event, entry) => {
    if( entry && typeof entry.message === 'string' ) {
      utils.log(entry.message, entry.data, entry.override);
    }
  });
  ipc.on('hide-current-window', (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    window && window.hide();
  });
  // webview 预加载脚本捕获到的视频卡片点击统一交给主窗口路由。
  ipc.on('open-webview-url', (event, url) => {
    if( !/^https?:\/\//i.test(url) || !mainWindow || mainWindow.isDestroyed() ) {
      return;
    }
    utils.log(`webview：收到播放器链接 ${url}`);
    mainWindow.webContents.send('webview-open-url', url);
  });
  ipc.on('get-current-window-bounds', (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    event.returnValue = window ? window.getBounds() : null;
  });
  ipc.on('set-current-window-bounds', (event, bounds) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    window && window.setBounds(bounds, true);
  });
  ipc.on('get-cursor-screen-point', (event) => {
    event.returnValue = screen.getCursorScreenPoint();
  });
  ipc.on('show-message-box', (event, options) => {
    event.returnValue = dialog.showMessageBoxSync(
      electron.BrowserWindow.fromWebContents(event.sender), options
    );
  });
}

function init() {
  utils.log(`主线程：初始化；Platform：${process.platform}`, null, true);
  initRendererIpc();
  initGlobalShortcut();
  initMenu();
  initMainWindow();
  initSelectPartWindow();
  initConfigWindow();
  initActionOnMessage();
  setProxy();
  initExchangeMessageForRenderers();
  utils.log('主线程：初始化流程结束');
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
let isInitialized = false;

async function enableBilibiliDarkTheme() {
  // B 站网页端的官方主题开关。必须在 webview 请求首页前写入，服务端才会
  // 直接返回深色样式，避免页面先以浅色闪现后再被脚本修改。
  await session.defaultSession.cookies.set({
    url: 'https://www.bilibili.com/',
    domain: '.bilibili.com',
    path: '/',
    name: 'theme_style',
    value: 'dark',
    expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  });
  utils.log('主题：已将哔哩哔哩网页主题设为暗色');
}

async function bootstrap() {
  // electron-store 从 v9 起只提供 ESM；在主进程异步加载后再创建窗口，
  // 同时仍为旧版 CommonJS 渲染层提供同步 IPC 配置接口。
  const { default: Store } = await import('electron-store');
  utils.attachConfigStore(new Store({ defaults: utils.configDefaults }));
  await app.whenReady();
  try {
    await enableBilibiliDarkTheme();
  } catch(err) {
    // Cookie 写入失败不应阻止播放器启动；B 站仍可按自身默认主题打开。
    utils.error(`主题：设置哔哩哔哩暗色模式失败\n${err}`);
  }
  init();
  isInitialized = true;
}

bootstrap().catch((err) => {
  console.error('配置存储初始化失败', err);
  app.quit();
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if( !isInitialized ) {
    return;
  }
  if( mainWindow === null ) {
    openMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('window-all-closed', () => {
  utils.log('主线程：所有窗口关闭');
  if( platform != 'darwin' ) {
    utils.log('主线程：非OSX平台，程序即将退出');
    app.quit();
  }
});

// 菜单
function initMenu() {
  utils.log('菜单：初始化');
  // 本来我们是不需要菜单的，但是因为mac上app必须有菜单，所以只在mac上做一下
  var template = [{
      label: app.name,
      submenu: [
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }, {
      label: 'Shortcuts',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectall' },
        {
          label: 'Backward',
          accelerator: 'Esc',
          click() { mainWindow.webContents.send('press-esc'); }
        }, { 
          label: 'Volume+',
          accelerator: 'Up',
          click() { mainWindow.webContents.send('change-volume', 'up'); }
        }, {
          label: 'Volume-',
          accelerator: 'Down',
          click() { mainWindow.webContents.send('change-volume', 'down'); }
        }
      ]
    }, {
      label: 'Debug',
      submenu: [
        {
          label: 'Inspect Main Window',
          accelerator: 'CmdOrCtrl+1',
          click() { mainWindow.webContents.openDevTools(); }
        },
        {
          label: 'Inspect Select Part Window',
          accelerator: 'CmdOrCtrl+2',
          click() { selectPartWindow.webContents.openDevTools(); }
        },
        {
          label: 'Inspect Config Window',
          accelerator: 'CmdOrCtrl+3',
          click() { configWindow.webContents.openDevTools(); }
        },
        {
          label: 'Inspect Webview',
          accelerator: 'CmdOrCtrl+4',
          click() { mainWindow.webContents.send('openWebviewDevTools'); }
        }
      ]
    }, {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];
  var menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  utils.log('菜单：初始化结束');
}

function registerGlobalShortcut(shortcut, name, action, isUpdate) {
  utils.log(`${name}：开始注册，isUpdate: ${!!isUpdate}`);
  let bindRes = false;
  try {
    bindRes = globalShortcut.register(shortcut, () => {
      action();
    });
  } catch(err) {
    // Electron 会对不符合 Accelerator 语法的字符串抛异常。直接在主进程
    // 验证并捕获，替代已长期无人维护的 electron-is-accelerator。
    utils.error(`${name}：快捷键格式无效 ${shortcut}\n${err}`);
  }
  if( !bindRes ) {
    utils.log(`${name}：注册失败`);
    dialog.showErrorBox(`修改${name}失败，「${shortcut}」可能不能用作全局快捷键或已被其他程序占用`, '');
    return false;
  } else if( isUpdate ) {
    dialog.showMessageBox({
      type: 'info',
      message: `修改成功，${name}已替换为「${shortcut}」`
    });
  }
  utils.log(`${name}：注册成功`);
  return true;
}

function bindHideShortcut(shortcut = utils.config.get('hideShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '老板键', () => {
    if( mainWindow ) {
      if( mainWindow.isVisible() ) {
        mainWindow.hide();
        selectPartWindow && selectPartWindow.isVisible() && selectPartWindow.hide();
        configWindow && configWindow.isVisible() && configWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    } else {
      openMainWindow();
    }
  }, isUpdate);
}

function bindPlayPauseShortcut(shortcut = utils.config.get('playPauseShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '播放/暂停快捷键', () => {
    mainWindow && mainWindow.webContents.send('toggle-playback');
  }, isUpdate);
}

function bindWebFullscreenShortcut(shortcut = utils.config.get('webFullscreenShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '网页全屏快捷键', () => {
    mainWindow && mainWindow.webContents.send('toggle-web-fullscreen');
  }, isUpdate);
}

function bindFocusWindowShortcut(shortcut = utils.config.get('focusWindowShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '窗口聚焦快捷键', () => {
    if( !mainWindow || mainWindow.isDestroyed() ) {
      openMainWindow();
      return;
    }
    if( !mainWindow.isVisible() ) {
      mainWindow.show();
    }
    mainWindow.focus();
  }, isUpdate);
}

function bindHistoryShortcut(shortcut = utils.config.get('historyShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '播放历史快捷键', () => {
    if( !mainWindow || mainWindow.isDestroyed() ) {
      openMainWindow();
    } else if( !mainWindow.isVisible() ) {
      mainWindow.show();
    }
    mainWindow && mainWindow.focus();
    mainWindow && mainWindow.webContents.send('open-recent-history');
  }, isUpdate);
}

function bindIncreasePlaybackRateShortcut(shortcut = utils.config.get('increasePlaybackRateShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '提高播放倍速快捷键', () => {
    mainWindow && mainWindow.webContents.send('change-playback-rate', 0.05);
  }, isUpdate);
}

function bindDecreasePlaybackRateShortcut(shortcut = utils.config.get('decreasePlaybackRateShortcut'), isUpdate) {
  return registerGlobalShortcut(shortcut, '降低播放倍速快捷键', () => {
    mainWindow && mainWindow.webContents.send('change-playback-rate', -0.05);
  }, isUpdate);
}

function updateGlobalShortcut(event, key, previous, next, bind) {
  globalShortcut.unregister(previous);
  utils.config.set(key, next);
  if( !bind(next, true) ) {
    utils.config.set(key, previous);
    bind(previous);
    event.sender.send('shortcut-update-failed', { key, shortcut: previous });
  }
}

function initGlobalShortcut() {
  ipc.on('update-hide-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'hideShortcut', previous, next, bindHideShortcut);
  });
  ipc.on('update-play-pause-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'playPauseShortcut', previous, next, bindPlayPauseShortcut);
  });
  ipc.on('update-web-fullscreen-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'webFullscreenShortcut', previous, next, bindWebFullscreenShortcut);
  });
  ipc.on('update-focus-window-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'focusWindowShortcut', previous, next, bindFocusWindowShortcut);
  });
  ipc.on('update-history-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'historyShortcut', previous, next, bindHistoryShortcut);
  });
  ipc.on('update-increase-playback-rate-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'increasePlaybackRateShortcut', previous, next, bindIncreasePlaybackRateShortcut);
  });
  ipc.on('update-decrease-playback-rate-shortcut', (ev, previous, next) => {
    updateGlobalShortcut(ev, 'decreasePlaybackRateShortcut', previous, next, bindDecreasePlaybackRateShortcut);
  });
  bindHideShortcut();
  bindPlayPauseShortcut();
  bindWebFullscreenShortcut();
  bindFocusWindowShortcut();
  bindHistoryShortcut();
  bindIncreasePlaybackRateShortcut();
  bindDecreasePlaybackRateShortcut();
}
