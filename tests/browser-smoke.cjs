'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

/** 使用独立浏览器档案，验收不会读写个人浏览器进度。 */
const executable = process.env.SPROUT_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.join(__dirname, '..');
const qa = path.join(root, '.qa');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sprout-browser-'));
const pending = new Map();
const exceptions = [];
const badResponses = [];
let browser;
let server;
let socket;
let sequence = 0;
let baseUrl;

/** 等待短暂浏览器事件循环。 */
function pause(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

/** 获取本机当前空闲端口，避免干扰其他开发服务。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => { const port = listener.address().port; listener.close(() => resolve(port)); });
  });
}

/** 通过浏览器调试协议发送一个请求。 */
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 12000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** 在实际页面中读取状态或触发界面操作。 */
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + JSON.stringify(result.exceptionDetails.exception));
  return result.result.value;
}

/** 等待真实界面条件成立，超时后给出对应场景。 */
async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(expression)) return;
    await pause(50);
  }
  throw new Error('等待超时：' + description);
}

/** 点击实际存在并可用的控件。 */
async function click(selector) {
  await evaluate('(function(){var item=document.querySelector(' + JSON.stringify(selector) + ');if(!item||item.disabled)throw new Error("控件不可用");item.click();})()');
  await pause(90);
}

/** 切换哈希页面并等待渲染。 */
async function navigate(hash) {
  await evaluate('location.hash=' + JSON.stringify(hash));
  await pause(130);
}

/** 通过实际输入事件筛选书目。 */
async function search(value) {
  await evaluate('(function(){var input=document.getElementById("book-search");input.value=' + JSON.stringify(value) + ';input.dispatchEvent(new Event("input",{bubbles:true}));})()');
}

/** 读取当前隔离档案保存的进度。 */
async function saved() { return evaluate('JSON.parse(localStorage.getItem(window.SproutCore.STORAGE_KEY))'); }

/** 保存截图并检查窄屏是否出现横向滚动。 */
async function screenshot(name, width, height, fullPage = false) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await pause(130);
  await evaluate('document.getElementById("toast").hidden=true');
  await evaluate('Promise.all(Array.from(document.images).filter(function(image){return image.loading!=="lazy";}).map(function(image){return image.complete?Promise.resolve():new Promise(function(resolve){image.onload=resolve;image.onerror=resolve;});}))');
  assert.equal(await evaluate('document.documentElement.scrollWidth>window.innerWidth'), false, name + ' 不应横向溢出');
  const options = { format: 'png', captureBeyondViewport: fullPage };
  if (fullPage) options.clip = { x: 0, y: 0, width, height: await evaluate('document.documentElement.scrollHeight'), scale: 1 };
  const result = await command('Page.captureScreenshot', options);
  fs.writeFileSync(path.join(qa, name + '.png'), Buffer.from(result.data, 'base64'));
}

/** 使用浏览器文件输入导入备份，保留正式校验和确认步骤。 */
async function uploadBackup(filename) {
  await command('Page.setInterceptFileChooserDialog', { enabled: true });
  await click('[data-action="import"]');
  const document = await command('DOM.getDocument');
  const input = await command('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type="file"]' });
  assert.ok(input.nodeId);
  await command('DOM.setFileInputFiles', { files: [filename], nodeId: input.nodeId });
  await pause(120);
}

/** 完成一次包含重试的真实练习流程。 */
async function completeQuiz(withMistake, bookId = 'aa-001') {
  const questions = await evaluate('window.SproutCore.buildQuestions(window.RAZ_LIBRARY.books.find(function(book){return book.id===' + JSON.stringify(bookId) + ';}))');
  for (let index = 0; index < questions.length; index += 1) {
    const answer = questions[index].correctIndex;
    if (withMistake && index === 0) {
      await click('[data-answer="' + (1 - answer) + '"]');
      assert.match(await evaluate('document.getElementById("quiz-feedback").textContent'), /再看看/);
    }
    await click('[data-answer="' + answer + '"]');
    const before = await saved();
    await evaluate('document.querySelector(' + JSON.stringify('[data-answer="' + answer + '"]') + ').click()');
    assert.deepEqual(await saved(), before, '重复提交不会改变已保存成绩');
    await click('[data-action="quiz-next"]');
  }
}

/** 运行包括素材加载、音频、备份与存储降级的端到端验收。 */
async function run() {
  fs.mkdirSync(qa, { recursive: true });
  const port = await freePort();
  const debugPort = await freePort();
  baseUrl = 'http://127.0.0.1:' + port + '/raz/';
  server = spawn(process.execPath, [path.join(root, 'server.cjs')], { windowsHide: true, stdio: 'ignore', env: Object.assign({}, process.env, { SPROUT_PORT: String(port), SPROUT_BASE_PATH: '/raz/' }) });
  browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeSidebarV2', '--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tabs;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { tabs = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json(); if (tabs.some(tab => tab.type === 'page')) break; }
    catch (error) { /* 浏览器调试端口启动前短暂不可用。 */ }
    await pause(100);
  }
  assert.ok(tabs && tabs.length, '无头浏览器应能启动');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    if (process.env.SPROUT_DEBUG) console.log(String(event.data).slice(0, 200));
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) badResponses.push(message.params.response.url);
  });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Network.enable');
  await command('Page.navigate', { url: baseUrl });
  await waitFor('document.querySelectorAll(".book-card").length===12', '首页书架');
  assert.equal(await evaluate('window.RAZ_LIBRARY.books.length'), 198);
  assert.match(await evaluate('document.querySelector("h1").textContent'), /小小的世界/);
  await screenshot('home-desktop', 1440, 1060, true);
  await screenshot('home-mobile', 390, 844, true);
  await screenshot('home-narrow', 320, 740);
  await search('农场');
  assert.equal(await evaluate('document.querySelectorAll(".book-card").length'), 1);
  await search('not-a-book');
  assert.ok(await evaluate('Boolean(document.querySelector(".empty-state"))'));
  await click('[data-action="reset-filters"]');
  await click('[data-category="colors"]');
  assert.equal(await evaluate('document.querySelectorAll(".book-card").length'), 8);
  await click('[data-category="all"]');
  await click('[data-action="load-more"]');
  assert.equal(await evaluate('document.querySelectorAll(".book-card").length'), 24);

  await navigate('read/aa-001/1');
  await waitFor('document.querySelector(".picture-stage img").complete', '绘本插图');
  assert.equal(await evaluate('document.querySelector(".reading-sentence").textContent'), 'The dog.');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reading-sentence")).fontSize'), '36px');
  assert.equal(await evaluate('document.querySelector(".hint-line").hidden'), true);
  await click('[data-action="toggle-hints"]');
  assert.match(await evaluate('document.querySelector(".hint-line").textContent'), /小狗/);
  await click('[data-action="font-cycle"]');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reading-sentence")).fontSize'), '44px');
  await screenshot('reader-desktop', 1440, 1060);
  await screenshot('reader-mobile', 390, 844, true);
  await screenshot('reader-narrow', 320, 740);
  await click('[data-action="audio-toggle"]');
  await waitFor('document.getElementById("book-audio").currentTime>0.1', '原音实际播放');
  assert.ok(await evaluate('document.getElementById("book-audio").duration>0'));
  await click('[data-action="next-page"]');
  assert.equal(await evaluate('document.getElementById("book-audio").paused'), false, '同本翻页保持整本原音');
  await click('[data-action="audio-toggle"]');
  assert.equal(await evaluate('document.getElementById("book-audio").paused'), true);
  await evaluate('(function(){var input=document.getElementById("audio-seek");input.value=3;input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  assert.ok((await evaluate('document.getElementById("book-audio").currentTime')) >= 2.9);
  await evaluate('(function(){var select=document.getElementById("audio-speed");select.value="0.75";select.dispatchEvent(new Event("change",{bubbles:true}));})()');
  assert.equal(await evaluate('document.getElementById("book-audio").playbackRate'), 0.75);
  await click('[data-action="original"]');
  assert.ok(await evaluate('Boolean(document.querySelector("[role=dialog] img"))'));
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'), false);
  await click('[data-action="credits"]');
  assert.equal(await evaluate('document.querySelectorAll(".source-images img").length'), 2);
  await click('[data-action="close-modal"]');
  const beforeReload = await saved();
  await command('Page.reload');
  await waitFor('Boolean(document.querySelector(".reading-sentence"))', '刷新恢复');
  assert.deepEqual(await saved(), Object.assign({}, beforeReload, { progress: Object.assign({}, beforeReload.progress, { 'aa-001': Object.assign({}, beforeReload.progress['aa-001'], { updatedAt: (await saved()).progress['aa-001'].updatedAt }) }) }));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reading-sentence")).fontSize'), '44px');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await pause(150);
  assert.match(await evaluate('location.hash'), /\/3$/);

  await navigate('read/aa-051/2');
  await screenshot('reader-folded-book', 1440, 1060);
  assert.equal(await evaluate('document.querySelector(".reading-sentence").textContent'), 'My bag.');
  await navigate('read/aa-001/8');
  await screenshot('reader-last-narrow', 320, 740, true);
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".page-controls button")).filter(function(button){return button.offsetParent!==null;}).every(function(button){var outer=document.querySelector(".page-controls").getBoundingClientRect();var rect=button.getBoundingClientRect();return rect.left>=outer.left&&rect.right<=outer.right;})'), true, '最后一页的翻页与原音按钮应完整显示');
  await click('[data-action="next-page"]');
  assert.equal(await evaluate('document.getElementById("book-audio").paused'), true, '离开阅读停止原音');
  await screenshot('practice-mobile', 390, 844, true);
  await screenshot('practice-narrow', 320, 740, true);
  await completeQuiz(true);
  assert.equal((await saved()).progress['aa-001'].stars, 2);
  assert.equal((await saved()).progress['aa-001'].completed, true);
  await screenshot('result-mobile', 390, 844);
  await click('[data-action="retry-quiz"]');
  await completeQuiz(false);
  assert.equal((await saved()).progress['aa-001'].stars, 3);
  await navigate('library');
  await click('[data-level="A"]');
  assert.equal(await evaluate('document.querySelector(".book-card h3").textContent'), 'Pond Animals');
  assert.equal(await evaluate('document.querySelector("[data-level=A]").getAttribute("aria-pressed")'), 'true');
  await screenshot('a-library-mobile', 390, 844, true);
  await screenshot('a-library-narrow', 320, 740);
  await navigate('read/a-001/1');
  assert.equal(await evaluate('document.querySelector(".reading-sentence").textContent'), 'I see eight bugs.');
  await screenshot('a-reader-mobile', 390, 844, true);
  await click('[data-action="parent-card"]');
  assert.match(await evaluate('document.getElementById("modal-title").textContent'), /Pond Animals/);
  assert.equal(await evaluate('document.querySelectorAll(".source-images img").length'), 4);
  assert.ok(await evaluate('document.querySelector(".source-images img").src.indexOf("a-001/card-01-1.jpg")!==-1'));
  await screenshot('a-parent-card', 390, 844);
  await click('[data-action="close-modal"]');
  await click('[data-action="audio-toggle"]');
  await waitFor('document.getElementById("book-audio").currentTime>0.1', 'A 级原音实际播放');
  assert.ok(await evaluate('document.getElementById("book-audio").src.indexOf("a-001.mp3")!==-1'));
  await navigate('practice/a-001');
  await completeQuiz(false, 'a-001');
  assert.equal((await saved()).progress['a-001'].stars, 3);
  assert.equal((await saved()).progress['aa-001'].stars, 3, 'A 级学习不能覆盖 AA 记录');
  await navigate('read/a-094/10');
  assert.equal(await evaluate('Boolean(document.querySelector(' + JSON.stringify('a[href="#practice/a-094"]') + '))'), false);
  await click('[data-action="next-page"]');
  assert.match(await evaluate('location.hash'), /progress/);
  assert.equal((await saved()).progress['a-094'].completed, true);
  await navigate('progress');
  await screenshot('progress-mobile', 390, 844);

  await click('[data-action="settings"]');
  await click('[data-font="52"]');
  await screenshot('settings-mobile', 390, 844);
  const downloads = fs.mkdtempSync(path.join(qa, 'downloads-'));
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await click('[data-action="export"]');
  let download;
  for (let attempt = 0; attempt < 50 && !download; attempt += 1) { await pause(100); download = fs.readdirSync(downloads).find(file => file.endsWith('.json')); }
  assert.ok(download, '导出应生成真实备份');
  const exported = JSON.parse(fs.readFileSync(path.join(downloads, download), 'utf8'));
  delete exported.exportedAt;
  assert.deepEqual(exported, await saved());
  const restored = JSON.parse(JSON.stringify(exported));
  restored.settings.fontSize = 36;
  restored.progress['aa-001'].page = 2;
  const backup = path.join(qa, 'import-test.json'); fs.writeFileSync(backup, JSON.stringify(restored));
  const beforeImport = await saved();
  await uploadBackup(backup);
  assert.match(await evaluate('document.getElementById("modal-title").textContent'), /导入/);
  assert.deepEqual(await saved(), beforeImport, '导入确认前不可替换进度');
  await click('[data-action="close-modal"]');
  assert.deepEqual(await saved(), beforeImport, '取消导入保留原进度');
  await click('[data-action="settings"]');
  await uploadBackup(backup);
  await click('[data-action="confirm-import"]');
  assert.deepEqual(await saved(), restored);
  const invalid = path.join(qa, 'invalid-test.json'); fs.writeFileSync(invalid, '{"version":999}');
  await click('[data-action="settings"]');
  await uploadBackup(invalid);
  assert.deepEqual(await saved(), restored, '无效备份不能破坏进度');
  assert.equal(await evaluate('document.getElementById("toast").hidden'), false);
  await click('[data-action="close-modal"]');

  const blocked = await command('Page.addScriptToEvaluateOnNewDocument', { source: 'Storage.prototype.getItem=function(){throw new Error("blocked");};Storage.prototype.setItem=function(){throw new Error("blocked");};' });
  await command('Page.reload');
  await waitFor('document.getElementById("storage-notice")&&!document.getElementById("storage-notice").hidden', '存储受限提示');
  await navigate('read/aa-001/1');
  assert.ok(await evaluate('Boolean(document.querySelector(".reading-sentence"))'));
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
  await command('Page.navigate', { url: 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/') + '#read/aa-001/1' });
  await waitFor('Boolean(document.querySelector(".reading-sentence"))', '直接打开静态文件');
  assert.equal(await evaluate('window.RAZ_LIBRARY.books.length'), 198);
  assert.deepEqual(exceptions, [], '浏览器不应出现未处理脚本异常');
  assert.deepEqual(badResponses, [], '仓库子路径中的素材不应返回错误');
  console.log('浏览器验收通过：书架筛选、分页、图文、原音播放/暂停/拖动/倍速、翻页、练习重试与奖励、刷新恢复、备份导出/确认导入/拒绝无效备份、存储降级、GitHub Pages 子路径、直接打开文件、1440/390/320 像素布局。');
  console.log('截图目录：' + qa);
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch (error) { /* 关闭浏览器时连接会先断开。 */ }
    socket.close();
  }
  if (browser) browser.kill();
  if (server) server.kill();
});
