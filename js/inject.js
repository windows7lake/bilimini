const ipc = require('electron').ipcRenderer;

// 诊断：记录页面自身（B 站 JS）发起的 window.open，用来判断「播放全部」
// 原生逻辑到底走了哪条路径。只在 webview 顶层页面 hook 一次。
if( window === window.top ) {
  const nativeOpen = window.open;
  window.open = function(url, ...rest) {
    debugClick(`页面 window.open: ${url}`);
    return nativeOpen.call(window, url, ...rest);
  };
}

function openBilibiliLinkInHost(url) {
  let target;
  try {
    target = new URL(url, window.location.href).href;
  } catch(err) {
    return false;
  }
  if( !/^https:\/\/(?:[\w-]+\.)?bilibili\.com\//i.test(target) && !/^https:\/\/b23\.tv\//i.test(target) ) {
    return false;
  }
  ipc.send('open-webview-url', target);
  return true;
}

// 占位符 href（#、javascript:、空链接等）不是真正的导航目标。B 站大量
// 功能按钮（如空间页的「播放全部」）会用这类 href 的 <a> 做壳子，点击后
// 由页面自己的 JS 处理。若把它们当成普通链接拦截，就会吞掉按钮逻辑，
// 同时因目标 URL 与当前页相同被主窗口去重，表现为「点了没反应」。
function hasNavigableHref(anchor) {
  const raw = anchor.getAttribute && anchor.getAttribute('href');
  if( !raw ) {
    return false;
  }
  const href = raw.trim();
  if( !href || href === '#' || href.startsWith('#') ) {
    return false;
  }
  if( /^(?:javascript|mailto|tel|data):/i.test(href) ) {
    return false;
  }
  return true;
}

// 判断是否为页面自身的功能控件。点击这类元素时应放行给 B 站的处理器，
// 不能一律当作导航链接接管。
function isInteractiveControl(node) {
  if( !node || node.nodeType !== 1 ) {
    return false;
  }
  const tag = node.tagName;
  if( tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ) {
    return true;
  }
  if( node.getAttribute && node.getAttribute('role') === 'button' ) {
    return true;
  }
  if( node.hasAttribute && node.hasAttribute('onclick') ) {
    return true;
  }
  if( typeof node.className === 'string' && /(?:^|[-_\s])(?:btn|button)(?:[-_\s]|$)/i.test(node.className) ) {
    return true;
  }
  return false;
}

// 目标链接是否指向当前页面本身（仅查询串/锚点不同）。这类链接常被 B 站
// 当作功能按钮的壳子，接管它会被主窗口的 lastTarget 去重丢弃，表现为无反应。
function isSamePageLink(url) {
  try {
    const target = new URL(url, window.location.href);
    const current = new URL(window.location.href);
    return target.origin === current.origin && target.pathname === current.pathname;
  } catch(err) {
    return false;
  }
}

function debugClick(msg) {
  ipc.send('webview-debug', msg);
}

// B 站个人空间/收藏页的「播放全部」是 vui 按钮，点击后由页面 JS 打开带播放
// 列表的 /list/ 页，但 webview 里这套逻辑不触发导航。识别后主动接管：拼出
// /list/{uid} 打开，这才是真正带播放列表的页面（/video/ 页没有列表）。
function isPlayAllButton(node) {
  if( !node || node.nodeType !== 1 ) {
    return false;
  }
  const cls = typeof node.className === 'string' ? node.className : '';
  if( /playall|play-all|play_all/i.test(cls) ) {
    return true;
  }
  const text = (node.textContent || '').trim();
  if( (node.tagName === 'BUTTON' || node.getAttribute && node.getAttribute('role') === 'button') &&
      /^播放全部$|^播放全部视频$/.test(text) ) {
    return true;
  }
  return false;
}

// 构造「播放全部」目标：B 站 UP 主投稿/收藏页的播放列表页形如
//   https://www.bilibili.com/list/{UID}?bvid=...&oid=...
// 其中路径上的 UID 决定列表内容，bvid/oid 仅指定从哪个视频起播（可选）。
// UID 来源优先级：当前 space 页 URL -> 页面内指向自己空间的链接。
function buildPlayAllListUrl() {
  // 1) 当前地址是 space.bilibili.com/{uid}（投稿/收藏页常见）
  let m = /(?:^|\/\/|\/)space\.bilibili\.com\/(\d+)/.exec(window.location.href);
  if( m && m[1] ) {
    const url = `https://www.bilibili.com/list/${m[1]}`;
    debugClick(`播放全部：由当前页 UID 构造 ${url}`);
    return url;
  }
  // 2) 页面里指向该 UP 主空间的链接（取出现最多的 UID，排除自己）
  const uidCount = {};
  document.querySelectorAll('a[href*="space.bilibili.com/"]').forEach((a) => {
    const mm = /space\.bilibili\.com\/(\d+)/.exec(a.href);
    if( mm && mm[1] ) uidCount[mm[1]] = (uidCount[mm[1]] || 0) + 1;
  });
  const topUid = Object.keys(uidCount).sort((a, b) => uidCount[b] - uidCount[a])[0];
  if( topUid ) {
    const url = `https://www.bilibili.com/list/${topUid}`;
    debugClick(`播放全部：由页面链接 UID(${uidCount[topUid]}次) 构造 ${url}`);
    return url;
  }
  return null;
}

// B 站会在捕获阶段自行处理评论和卡片链接，导致 webview 既不导航也不
// 触发 window.open。这里在捕获阶段接管真正的站内导航链接；对功能按钮和
// 占位符链接则放行，避免破坏「播放全部」等由页面 JS 驱动的交互。
document.addEventListener('click', (event) => {
  if( event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) {
    return;
  }
  const path = event.composedPath ? event.composedPath() : [];
  for( const node of path ) {
    if( !node || node.nodeType !== 1 ) {
      continue;
    }
    // 「播放全部」按钮：优先放行给 B 站原生逻辑（加了 allowpopups 后，
    // 它发起的 window.open 会经主进程转到当前窗口，得到带列表的 /list/ 页）。
    // 若 900ms 内页面没有任何导航，再用自定义 /list/{uid} 兜底。
    if( isPlayAllButton(node) ) {
      const before = window.location.href;
      debugClick('播放全部：放行原生，等待 900ms');
      setTimeout(() => {
        if( window.location.href !== before ) {
          debugClick('播放全部：原生已导航，无需兜底');
          return;
        }
        const listUrl = buildPlayAllListUrl();
        debugClick(`播放全部：原生无反应，兜底 ${listUrl || '未找到 UID'}`);
        if( listUrl ) openBilibiliLinkInHost(listUrl);
      }, 900);
      return;
    }
    // 在遇到链接之前先碰到功能控件：交给页面自己处理。
    if( isInteractiveControl(node) ) {
      debugClick(`放行：功能控件 ${node.tagName}.${node.className || ''}`);
      return;
    }
    if( node.tagName === 'A' ) {
      // 占位符链接 / 指向当前页的链接放行，避免吞掉功能按钮。
      if( !hasNavigableHref(node) ) {
        debugClick(`放行：占位符链接 ${node.getAttribute('href')}`);
        return;
      }
      if( isSamePageLink(node.href) ) {
        debugClick(`放行：同页链接 ${node.href}`);
        return;
      }
      if( node.href && openBilibiliLinkInHost(node.href) ) {
        debugClick(`接管：${node.href}`);
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
  }
}, true);

window.addEventListener('DOMContentLoaded', function() {
  function setPlaybackState(shouldPlay) {
    const video = document.querySelector('video');
    if( !video ) {
      return;
    }
    if( shouldPlay && video.paused ) {
      video.play().catch(() => {});
    } else if( !shouldPlay && !video.paused ) {
      video.pause();
    }
  }

  ipc.on('toggle-playback', () => {
    const video = document.querySelector('video');
    if( !video ) {
      return;
    }
    setPlaybackState(video.paused);
  });

  ipc.on('set-playback-state', (ev, shouldPlay) => {
    setPlaybackState(shouldPlay);
  });

  ipc.on('change-playback-rate', (ev, amount) => {
    const video = document.querySelector('video');
    const delta = Number(amount);
    if( !video || !Number.isFinite(delta) ) {
      return;
    }
    // B 站播放器会监听 video 的 ratechange 事件并同步更新控制栏。使用
    // 0.05x 的颗粒度，兼顾精细调速与自定义倍速视频。
    const nextRate = Math.max(0.25, Math.min(4, Math.round((video.playbackRate + delta) * 100) / 100));
    video.playbackRate = nextRate;
  });

  ipc.on('toggle-web-fullscreen', () => {
    // 优先调用 B 站自己的“网页全屏”控制，它会同步隐藏页面周边内容；
    // 不同播放器版本的 class 名不同，保留标准 Fullscreen API 作为回退。
    const selectors = [
      '.bpx-player-ctrl-web',
      '.bilibili-player-video-web-fullscreen',
      '[class*="player-iconfont-web-fullscreen"]',
      '[class*="pagefullscreen"]'
    ];
    const button = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if( button ) {
      button.click();
      return;
    }
    if( document.fullscreenElement ) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const video = document.querySelector('video');
    video && video.requestFullscreen && video.requestFullscreen().catch(() => {});
  });

  // B 站当前的 AI 中文字幕轨使用 data-lan="ai-zh"。字幕菜单通常会在
  // 点击控制栏按钮后才挂载，因此先直接选择，找不到时再打开菜单并短暂重试。
  function enableAiChineseSubtitle() {
    if( !/bilibili\.com\/(?:video\/|bangumi\/play\/)/.test(location.href) ) {
      return;
    }
    let attempts = 0;
    const maxAttempts = 30;
    const timer = setInterval(() => {
      const aiChinese = document.querySelector('[data-lan="ai-zh"]');
      if( aiChinese ) {
        aiChinese.click();
        clearInterval(timer);
        return;
      }
      // 不同播放器版本使用不同的字幕控制类名，保留语义选择器作为回退。
      const trigger = document.querySelector(
        '.bpx-player-ctrl-subtitle, .bpx-player-ctrl-subtitle-button, ' +
        '[class*="player-ctrl"][class*="subtitle"], [aria-label*="字幕"], [title*="字幕"]'
      );
      if( trigger && attempts % 6 === 0 ) {
        trigger.click();
      }
      attempts += 1;
      if( attempts >= maxAttempts ) {
        clearInterval(timer);
      }
    }, 500);
  }
  enableAiChineseSubtitle();

  // 普通视频页：自动最大化播放器
  if( window.location.href.indexOf('video/av') > -1 || 
      window.location.href.indexOf('video/BV') > -1 ||
      window.location.href.indexOf('html5player.html') > -1 ||
      window.location.href.indexOf('bangumi/play/') > -1 ) {
    let playerInitCheck = setInterval(() => {
      let wideScreenButton;
      if( wideScreenButton = document.querySelector(
        '[class*="bilibili-player-iconfont-web-fullscreen"],[class*="squirtle-video-pagefullscreen"]'
      ) ) {
        wideScreenButton.click();
        // 隐藏全屏播放器（在某些情况下会出现）的滚动条
        document.body.style.overflow = 'hidden';
        // 从app层面把 上、下 按键传进来，方便播放器控制音量
        ipc.on('change-volume', (ev, arg) => {
          let event = new KeyboardEvent('keydown', {
            bubbles: true
          });
          // 傻逼玩意儿which和keycode因为deprecated变成只读了，替代的属性又还没通用，搞条毛？
          Object.defineProperties(event, {
            keyCode: { writeable: true, value: arg == 'up' ? 38 : 40 }
          });
          let volume = document.querySelector('.bilibili-player-iconfont-volume-max');
          volume.dispatchEvent(event);
        });
        clearInterval(playerInitCheck);
      } else if( ++checkCount > 100 ) {
        clearInterval(playerInitCheck);
      }
    }, 50), checkCount = 0;
  }

  // 番剧页：获取播放器iframe地址并转跳
  else if( /anime\/\d+\/play/.test(window.location.href) ) {
    var playerInitCheck = setInterval(() => {
      let ifr;
      if( ifr = document.querySelector('iframe') ) {
        if( ifr.src.indexOf('iframemessage.html') == -1 ) {
          window.location.href = ifr.src;
          clearInterval(playerInitCheck);
        }
      } else if( ++checkCount > 400 ) {
        clearInterval(playerInitCheck);
      }
    }, 50), checkCount = 0;
  }

  // 动态页重做样式
  else if( window.location.href.includes('t.bilibili.com/?tab=8') ) {
    const style = document.createElement('style');
    style.innerHTML = '#bili-header-m, .left-panel, .right-panel, .center-panel > .section-block, .sticky-bar { display: none !important }' +
                      '.home-content, .center-panel { width: 100% !important; }' +
                      '.card { min-width: 0 !important;}'
    document.head.appendChild(style)
  }

  // /blanc/:id才是真正的直播播放器所在页面
  // 它有时会作为iframe嵌入到直播间里，此时无法直接操作到播放器，所以转跳到实际播放器所在页面
  const liveId = /\/\/live\.bilibili\.com\/(\d+)/.exec(window.location.href);
  if ( liveId ) {
    window.location.href = `https://live.bilibili.com/blanc/${liveId[1]}?liteVersion=true`;
  }

  // 直播使用桌面版 HTML5 直播播放器
  else if ( /\/\/live\.bilibili\.com\/blanc\/\d+/.test(window.location.href) ) {
    let playerInitCheck = setInterval(() => {
      // 通过查询 HTML5 播放器 DIV 来判断页面加载
      if( document.querySelector('.bp-no-flash-tips') ) {
        // 切换 HTML5 播放器
        window.EmbedPlayer.loader();
      } else if( window.__PlayerInitialized ) {
        // 全屏播放器并隐藏聊天栏
        document.getElementsByTagName('body')[0].classList.add('player-full-win', 'hide-aside-area');
        // 隐藏聊天栏显示按钮
        let aside = document.getElementsByClassName('aside-area-toggle-btn')[0];
        aside.style.display = 'none';
        // 隐藏全屏播放器（在某些情况下会出现）的滚动条
        document.body.style.overflow = 'hidden';
        // 移除haruna
        const haruna = document.getElementById('my-dear-haruna-vm');
        haruna?.remove();
        clearInterval(playerInitCheck);
      } else if( ++checkCount > 1000 ) {
        clearInterval(playerInitCheck);
      }
    }, 100), checkCount = 0;
  }

});

window.addEventListener("load", function () {
  // 移除app广告
  function removeAppAd() {
    const appAdNode = document.querySelectorAll('[class*="launch-app-btn" i]');
    appAdNode.forEach((node) => {
      node.remove();
    });
  }
  removeAppAd();
})
