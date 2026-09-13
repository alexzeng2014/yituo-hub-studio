/* 浏览器实测：导入文章包（含大图缩放、Obsidian 双链、单篇导入）。
 * 用法：node qa-import-browser.js
 * 需要本机有 Chrome 或 Edge，脚本自己起静态服务。
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const CHROME_CANDIDATES = [
  process.env.YITUO_QA_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find(function (candidate) { return fs.existsSync(candidate); });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg'
};

let fail = false;
function report(label, ok, detail) {
  console.log(label + ' ' + (ok ? 'PASS' : 'FAIL') + (detail ? ' ' + detail : ''));
  if (!ok) fail = true;
}
function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
async function poll(fn, timeout, label) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await wait(120);
  }
  throw new Error('等待超时：' + label + (last ? '（' + last + '）' : ''));
}

function serve(root) {
  const server = http.createServer(function (request, response) {
    const url = decodeURIComponent((request.url || '/').split('?')[0]);
    let filePath = path.join(root, url === '/' ? '/studio.html' : url);
    if (!filePath.startsWith(root)) { response.writeHead(403); response.end(); return; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      }
    });
  }
  async send(method, params) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve, reject: reject });
      this.socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

const PAGE_SCRIPT = `(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const doc = document;
  const editor = doc.getElementById('editor');
  const results = [];
  const errors = [];
  window.addEventListener('error', e => errors.push(String(e.message)));

  function fakeFile(bytes, name, type, relPath) {
    const file = new File([bytes], name, { type });
    Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
    return file;
  }
  async function importInto(inputId, files) {
    const input = doc.getElementById(inputId);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await wait(1200);
  }
  async function imageEdge(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = dataUrl;
    });
  }

  results.push({ name: '工具栏有导入文章包按钮', ok: !!doc.getElementById('btnImportPackage') });
  results.push({ name: '工具栏有导入 MD / TXT 按钮', ok: !!doc.getElementById('btnImportFile') });
  results.push({ name: '两个隐藏 input 就位', ok: !!(doc.getElementById('importPackageInput') && doc.getElementById('importFileInput')) });

  // 第一轮：md + 小图，图片放在 demo/img/ 下，md 里写 img/cover.png
  const canvas = document.createElement('canvas');
  canvas.width = 2400; canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 2400, 1600);
  grad.addColorStop(0, '#33546F'); grad.addColorStop(1, '#C0392B');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2400, 1600);
  const bigBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));

  const md = ['# 导入测试 / 文章包', '', '正文第一段。', '', '![大图](img/big.png)', '', '双链图：![[img/big.png]]', '', '<img src="img/big.png" alt="标签写法">', '', '![外链](https://example.com/x.png)', ''].join('\\n');
  await importInto('importPackageInput', [
    fakeFile(md, 'article.md', 'text/markdown', 'demo/article.md'),
    fakeFile(bigBlob, 'big.png', 'image/png', 'demo/img/big.png'),
    fakeFile('# 说明\\n', 'README.md', 'text/markdown', 'demo/README.md')
  ]);

  const text = editor.value;
  results.push({ name: '正文替换为导入文稿', ok: text.indexOf('正文第一段。') !== -1 });
  results.push({ name: '跳过 README 选正文', ok: text.indexOf('导入测试') !== -1 && text.indexOf('说明') === -1 });
  results.push({ name: '标准写法图片已内联', ok: text.indexOf('![大图](data:image/png;base64,') !== -1 });
  results.push({ name: 'Obsidian 双链已内联', ok: text.indexOf('双链图：![](data:image/png;base64,') !== -1 });
  results.push({ name: '手写 img 标签已内联', ok: /<img src="data:image\\/png;base64,[^"]+" alt="标签写法">/.test(text) });
  results.push({ name: '外链图片没被改', ok: text.indexOf('![外链](https://example.com/x.png)') !== -1 });
  results.push({ name: '提示条报告导入结果', ok: /已导入 article.md/.test(doc.getElementById('toast').textContent || '') });

  const inline = (text.match(/data:image\\/png;base64,[A-Za-z0-9+/=]+/) || [])[0] || '';
  const edge = await imageEdge(inline);
  results.push({ name: '超大图被缩到 1600px 以内', ok: edge.w > 0 && edge.w <= 1600, detail: '实际宽度=' + edge.w });
  results.push({ name: '预览里出现内联图片', ok: (doc.getElementById('preview').srcdoc || '').indexOf('data:image/png;base64,') !== -1 });

  const copyButton = doc.getElementById('btnCopy');
  results.push({ name: '复制到公众号按钮仍在', ok: !!copyButton });

  // 第二轮：单篇导入
  await importInto('importFileInput', [fakeFile('# 单篇导入\\n\\n没有图片。\\n', 'solo.md', 'text/markdown', 'solo.md')]);
  results.push({ name: '单篇导入替换正文', ok: editor.value.indexOf('没有图片') !== -1 });
  results.push({ name: '单篇导入给了提示', ok: /已导入 solo.md/.test(doc.getElementById('toast').textContent || '') });

  return { results, errors };
})()`;

async function main() {
  if (!CHROME) throw new Error('本机找不到 Chrome / Edge，可用 YITUO_QA_CHROME 指定路径');
  const server = await serve(ROOT);
  const url = 'http://127.0.0.1:' + server.port + '/studio.html';
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yituo-import-qa-'));
  const profileDir = path.join(sessionDir, 'chrome-profile');
  fs.mkdirSync(profileDir);
  const port = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profileDir,
    '--window-size=1600,1100', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let cdp;
  try {
    await poll(async function () {
      const response = await fetch('http://127.0.0.1:' + port + '/json/version');
      return response.ok;
    }, 15000, 'Chrome 调试端口');

    const targetResponse = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const target = await targetResponse.json();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready;

    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Log.enable'),
      cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    ]);
    await cdp.send('Page.navigate', { url: url });
    await wait(2500);

    const evaluation = await cdp.send('Runtime.evaluate', {
      expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true
    });
    if (evaluation.exceptionDetails) throw new Error('页面脚本报错：' + JSON.stringify(evaluation.exceptionDetails.text || evaluation.exceptionDetails));
    const out = evaluation.result.value || {};
    (out.results || []).forEach(function (item) { report(item.name, item.ok, item.detail); });
    if ((out.errors || []).length) report('页面没有 JS 报错', false, JSON.stringify(out.errors));
    else report('页面没有 JS 报错', true);
  } finally {
    if (cdp) { try { await cdp.send('Browser.close'); } catch (_) {} cdp.close(); }
    try { chrome.kill(); } catch (_) {}
    server.server.close();
  }

  console.log(fail ? '\n有失败项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
}

main().catch(function (error) {
  console.error('浏览器实测失败：', error.message);
  process.exit(1);
});