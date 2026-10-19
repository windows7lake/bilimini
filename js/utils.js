const fs = require('fs');

// 设置默认值由主进程的 electron-store 持久化。渲染进程不再各自创建
// electron-store 实例，避免缓存不一致，也让主进程可以使用新版 ESM-only 库。
const configDefaults = {
    windowSizeMini: [300, 187],
    windowSizeFeed: [650, 760],
    windowSizeDefault: [375, 500],
    opacity: 0.9999,
    autoPause: false,
    hideShortcut: 'Alt + Q',
    playPauseShortcut: 'Alt + W',
    webFullscreenShortcut: 'Alt + D',
    focusWindowShortcut: 'Alt + S',
    historyShortcut: 'Alt + A',
    proxy: ''
};

let configStore = null;
const isRenderer = process.type === 'renderer';

function rendererIpc() {
    return require('electron').ipcRenderer;
}

var config = {
    get(key) {
        if( isRenderer ) {
            return rendererIpc().sendSync('config-get', key);
        }
        if( !configStore ) {
            return configDefaults[key];
        }
        const value = configStore.get(key);
        return value === undefined ? configDefaults[key] : value;
    },
    set(key, value) {
        if( isRenderer ) {
            return rendererIpc().sendSync('config-set', key, value);
        }
        if( typeof key == 'object' ) {
            for( let k in key ) {
                configStore.set(k, key[k]);
                log.write({
                    message: `更新用户设置：SET ${k} = ${JSON.stringify(key[k])}`
                });
            }
        } else {
            configStore.set(key, value);
            log.write({
                message: `更新用户设置：SET ${key} = ${JSON.stringify(value)}`
            });
        }
    },
    delete(key) {
        if( isRenderer ) {
            return rendererIpc().sendSync('config-delete', key);
        }
        configStore.delete(key);
    }
};

function attachConfigStore(store) {
    configStore = store;
}

// ajax
var ajax = {
    get: function(url, success, mode) {
        var r = new XMLHttpRequest();
        r.open("GET", url, true);
        if( mode in userAgent ) {
            r.setRequestHeader('userAgent', userAgent[mode]);
        }
        r.onreadystatechange = function () {
            if (r.readyState != 4 || r.status != 200) return;
            success(r.responseText);
        };
        r.send();
    }
}

function getAppPath() {
    const slash = require('path').sep;
    var logFilePath = __dirname.split(slash);
    logFilePath.length = logFilePath.lastIndexOf('bilimini') + 1;
    logFilePath.push('');
    return logFilePath.join(slash);
}
const appPath = getAppPath();

function getVidWithP(url) {
    const m  = /video\/(av\d+(?:\/?\?p=\d+)?)/.exec(url) ||
             /video\/(BV\w+(?:\/?\?p=\d+)?)/.exec(url)
    return m ? m[1] : null;
}

function getVid(url) {
    const m = /video\/(av\d+)/.exec(url) || /video\/(BV\w+)/.exec(url);
    return m ? m[1] : null;
}

function getFirstJsonFromString(text) {
    const len = text.length;
    for( let i = 0; i < len; i++ ) {
        if( text[i] === '}' ) {
            try {
                const str = text.substr(0, i+1);
                return JSON.parse(str);
            } catch(e) {
                // 
            }
        }
    }
    return false;
}

Date.prototype.format = function() {
    return `${this.toLocaleDateString()} ${this.toTimeString().split(' ')[0]} ` + 
            ('000' + this.getMilliseconds()).slice(-3);
}
var log = {
    write(obj) {
        var logFileName = appPath + 'bilimini.log',
            now = new Date();
            _msg = '',
            LF = '\r\n' + ' '.repeat(23);
        // 让每个换行前都空出33个字符的距离，这样能让message对齐
        var message = obj.message.replace(/\n/g, LF);
        if( obj.data ) {
            message += `${LF} ${JSON.stringify(obj.data)}`;
        }
        if( obj.type ) {
            _msg = `* ${now.format()} ${obj.type} > ${message}\r\n`;
        } else {
            _msg = `${now.format()} ${message}\r\n`;
        }
        if( obj.override ) {
            fs.writeFileSync(logFileName, _msg);
        } else {
            fs.appendFileSync(logFileName, _msg);
        }
    }
}

module.exports = {
    config,
    configDefaults,
    attachConfigStore,
    ajax,
    getVid,
    getVidWithP,
    getFirstJsonFromString,
    log(message, data, override) {
        log.write({
            message,
            data,
            override
        });
    },
    error(message, data, override) {
        log.write({
            message, data, override, type: 'ERROR'
        });
    }
}
