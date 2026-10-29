(function () {
  'use strict';

  var Core = window.SproutCore;
  var library = window.RAZ_LIBRARY;
  var main = document.getElementById('main');
  if (!Core || !library || !library.books.length) {
    main.innerHTML = '<div class="empty-state"><h1>书架还没有准备好</h1><p>请确认 data/catalog.js 与 assets 文件夹已一同上传。</p></div>';
    return;
  }
  var books = library.books;
  var bookIndex = {};
  books.forEach(function (book) { bookIndex[book.id] = book; });
  /** 主题名称来自学习内容分类，不对应学校年级。 */
  var CATEGORIES = [['all', '全部绘本'], ['animals', '动物朋友'], ['colors', '缤纷颜色'], ['numbers', '数字乐园'], ['nature', '自然四季'], ['life', '生活发现'], ['concepts', '大小方位']];
  /** 分页限制首屏图片请求，后续由孩子主动加载。 */
  var PAGE_SIZE = 12;
  /** 进度备份只包含少量文本，限制为 2 MB 避免误选媒体或大文件。 */
  var MAX_BACKUP_BYTES = 2 * 1024 * 1024;
  var state = Core.initialState();
  var canStore = true;
  var shelf = { level: 'AA', category: 'all', search: '', status: 'all', limit: PAGE_SIZE };
  var currentBook = null;
  var currentPage = 1;
  var quiz = null;
  var audio = document.getElementById('book-audio');
  var audioBook = null;
  var toastTimer = null;
  var lastFocus = null;
  var pendingImport = null;

  /** 转义资料中的文字，保证书名和原文只能作为文本展示。 */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]; });
  }

  /** 生成站内统一的线条图标。 */
  function icon(name) {
    var shapes = {
      book: '<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3Z"/><path d="M12 6v15"/>',
      arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
      back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
      headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      leaf: '<path d="M20 4C9 2 3 7 4 14c1 7 14 9 16-10Z"/><path d="M4 21 15 10m-8 8-1-6m5 2 6 1"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      play: '<path d="m8 5 11 7-11 7Z"/>',
      pause: '<path d="M8 5v14m8-14v14"/>',
      repeat: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
      volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
      upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
      heart: '<path d="M20 5c-3-3-7-1-8 2C11 4 7 2 4 5c-5 5 2 11 8 15 6-4 13-10 8-15Z"/>'
    };
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (shapes[name] || shapes.leaf) + '</svg>';
  }

  /** 在当前页面显示短提示，不打断孩子的操作。 */
  function toast(message) {
    var target = document.getElementById('toast');
    target.textContent = message;
    target.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { target.hidden = true; }, 4500);
  }

  /** 持久显示学习记录保存异常，避免误以为已经同步。 */
  function storageWarning(message) {
    var target = document.getElementById('storage-notice');
    target.textContent = message;
    target.hidden = false;
  }

  /** 只读取本站档案，损坏记录不会自动覆盖原始备份。 */
  function loadState() {
    try {
      var raw = localStorage.getItem(Core.STORAGE_KEY);
      if (raw) state = Core.validateState(JSON.parse(raw), books);
    } catch (error) {
      canStore = false;
      storageWarning('暂时无法读取或保存学习记录。本次仍可学习，请在结束时导出进度备份。');
    }
  }

  /** 存储受限时继续使用内存，并明确提示导出备份。 */
  function saveState() {
    if (!canStore) return;
    try { localStorage.setItem(Core.STORAGE_KEY, JSON.stringify(state)); }
    catch (error) {
      canStore = false;
      storageWarning('浏览器未能保存进度。离开前请到家长设置导出备份。');
    }
  }

  /** 应用阅读设置，整本原音与设备朗读分别使用同一速率。 */
  function applySettings() {
    document.documentElement.style.setProperty('--reading-size', state.settings.fontSize + 'px');
    audio.playbackRate = state.settings.speed;
  }

  /** 生成可直接用于 GitHub Pages 子目录的哈希阅读链接。 */
  function readUrl(book, page) {
    return '#read/' + book.id + '/' + (page || (state.progress[book.id] ? state.progress[book.id].page : 1));
  }

  /** 渲染一本真实绘本的封面卡片。 */
  function bookCard(book) {
    var entry = state.progress[book.id];
    var completed = entry && entry.completed;
    var label = completed ? (entry.stars ? '★ ' + entry.stars + ' · 已读完' : '已读完') : (entry ? '读到第 ' + entry.page + ' 页' : '等你来读');
    var url = readUrl(book);
    return '<article class="book-card"><a class="cover-link" href="' + url + '" aria-label="阅读 ' + escapeHtml(book.title) + '"><span class="book-number">NO. ' + String(book.number).padStart(2, '0') + '</span><img class="book-cover" src="' + book.cover + '" alt="' + escapeHtml(book.title) + ' 绘本封面" loading="lazy" width="132" height="202"><span class="card-status' + (completed ? ' completed' : '') + '">' + (completed ? icon('check') : '') + escapeHtml(label) + '</span></a><div class="card-info"><h3 lang="en"><a href="' + url + '">' + escapeHtml(book.title) + '</a></h3><p class="card-chinese">' + escapeHtml(book.chineseTitle) + '</p><div class="card-bottom"><span class="card-meta">' + icon('headphones') + (book.audio ? '原音 · ' : '暂无原音 · ') + book.pages.length + ' 页</span><a class="card-open" href="' + url + '" aria-label="开始阅读 ' + escapeHtml(book.title) + '">' + icon('arrow') + '</a></div></div></article>';
  }

  /** 获取同时符合主题、关键词与阅读状态的书目。 */
  function filteredBooks() {
    var query = shelf.search.trim().toLowerCase();
    return books.filter(function (book) {
      var entry = state.progress[book.id];
      return book.level === shelf.level && (shelf.category === 'all' || shelf.category === book.category) && (!query || (book.title + ' ' + book.chineseTitle + ' ' + book.number).toLowerCase().indexOf(query) !== -1) && (shelf.status === 'all' || (shelf.status === 'unread' && !entry) || (shelf.status === 'reading' && entry && !entry.completed) || (shelf.status === 'completed' && entry && entry.completed));
    });
  }

  /** 保留搜索框焦点，仅更新筛选结果。 */
  function renderShelfResults() {
    var filtered = filteredBooks();
    var target = document.getElementById('book-grid');
    if (!target) return;
    document.getElementById('result-count').textContent = '共 ' + filtered.length + ' 本绘本，选一本开始吧';
    target.innerHTML = filtered.length ? filtered.slice(0, shelf.limit).map(bookCard).join('') : '<div class="empty-state"><h3>这片小书架还没有找到绘本</h3><p>换个词，或者看看其他主题吧。</p><button class="button soft" type="button" data-action="reset-filters">查看全部绘本</button></div>';
    document.getElementById('more-wrap').innerHTML = filtered.length > shelf.limit ? '<button class="button secondary" type="button" data-action="load-more">再看看更多绘本 ' + icon('arrow') + '</button><p>已展示 ' + Math.min(shelf.limit, filtered.length) + ' / ' + filtered.length + ' 本</p>' : (filtered.length ? '<p>小书架都在这里了，慢慢读，不着急。</p>' : '');
    Array.prototype.forEach.call(document.querySelectorAll('[data-category]'), function (button) {
      var selected = button.getAttribute('data-category') === shelf.category;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  /** 绘制小芽书架与可继续阅读的首页。 */
  function renderLibrary() {
    var totals = Core.summary(state);
    var levelBooks = books.filter(function (book) { return book.level === shelf.level; });
    var latest = state.lastBook ? bookIndex[state.lastBook] : null;
    var recent = latest && latest.level === shelf.level ? latest : null;
    var first = recent || levelBooks[0];
    var featured = [levelBooks[1] || first, first, levelBooks[3] || first];
    main.innerHTML = '<section class="hero" aria-labelledby="welcome-title"><div class="hero-copy"><div class="eyebrow">A LITTLE READING, EVERY DAY</div><h1 id="welcome-title">今天，读一个<br><em>小小的世界。</em></h1><p class="hero-description">看一幅画，听一句英语。<br>让每一颗好奇心，都慢慢发芽。</p><a class="button primary" href="' + readUrl(first) + '">' + icon('book') + '<span>' + (recent ? '继续上次阅读' : '开启阅读小冒险') + '</span>' + icon('arrow') + '</a><span class="hero-note">每天一小本，快乐多一点</span></div><div class="hero-art"><div class="hero-orbit"></div><span class="hero-tag">a little world of wonder</span><span class="sparkle" aria-hidden="true">✧</span><span class="sparkle second" aria-hidden="true">✧</span><a class="hero-book back" href="' + readUrl(featured[0]) + '" aria-label="阅读 ' + escapeHtml(featured[0].title) + '"><img src="' + featured[0].cover + '" alt="" width="139" height="211"></a><a class="hero-book main" href="' + readUrl(featured[1]) + '" aria-label="阅读 ' + escapeHtml(featured[1].title) + '"><img src="' + featured[1].cover + '" alt="" width="170" height="245"></a><a class="hero-book front" href="' + readUrl(featured[2]) + '" aria-label="阅读 ' + escapeHtml(featured[2].title) + '"><img src="' + featured[2].cover + '" alt="" width="132" height="197"></a><svg class="hero-sprig" viewBox="0 0 120 150" fill="none" aria-hidden="true"><path d="M59 145C64 109 64 73 49 23" stroke="currentColor" stroke-width="2"/><path d="M60 116C29 119 24 100 21 87c24-1 40 10 39 29ZM62 90c30-9 32-29 29-42C67 55 56 70 62 90ZM56 65C32 65 20 47 22 34c23 0 35 12 34 31ZM49 31C30 21 32 9 34 3c14 4 20 15 15 28ZM61 125c24-2 38-14 41-29-26-2-37 13-41 29Z" fill="currentColor" opacity=".6"/></svg><div class="hero-sticker"><b>' + shelf.level + '</b> · 我的英文书架</div></div></section>' +
      '<section class="reading-strip" aria-label="阅读进度"><div class="strip-intro"><span class="strip-icon">' + icon('sun') + '</span><div><strong>' + (totals.started ? '每读一本，都在悄悄长大' : '你好，小小阅读家！') + '</strong><p>' + (recent ? '上次读到 ' + escapeHtml(recent.title) + '，今天接着探索吧。' : '从喜欢的封面开始，找到今天的小惊喜。') + '</p></div></div><div class="strip-numbers"><div class="strip-stat"><strong>' + books.length + '</strong>本绘本</div><div class="strip-stat"><strong>' + totals.completed + '</strong>本已读</div><div class="strip-stat"><strong>' + totals.stars + '</strong>颗星星</div></div></section>' +
      '<section aria-labelledby="shelf-title"><div class="section-heading"><div><h2 id="shelf-title">' + icon('book') + '我的小书架</h2><p>每一本，都是认识世界的一扇小窗。</p></div><span class="level-pill"><b>' + shelf.level + '</b> 英语启蒙</span></div><div class="level-row"><span>阅读分级</span><div class="level-switch" role="group" aria-label="阅读分级"><button type="button" data-level="AA" aria-pressed="' + (shelf.level === 'AA') + '" class="' + (shelf.level === 'AA' ? 'active' : '') + '">AA 级</button><button type="button" data-level="A" aria-pressed="' + (shelf.level === 'A') + '" class="' + (shelf.level === 'A' ? 'active' : '') + '">A 级</button></div></div><div class="shelf-tools"><div class="category-tabs" role="group" aria-label="绘本主题">' + CATEGORIES.map(function (row) { return '<button type="button" data-category="' + row[0] + '" aria-pressed="' + String(shelf.category === row[0]) + '" class="' + (shelf.category === row[0] ? 'active' : '') + '">' + row[1] + '</button>'; }).join('') + '</div><label class="search-wrap">' + icon('search') + '<input id="book-search" type="search" placeholder="找一找喜欢的绘本" aria-label="搜索英文或中文绘本名称" value="' + escapeHtml(shelf.search) + '"></label></div><div class="filter-row"><span id="result-count" role="status" aria-live="polite"></span><label>阅读状态 <select id="status-filter" aria-label="筛选阅读状态"><option value="all">全部状态</option><option value="unread">还没读过</option><option value="reading">正在阅读</option><option value="completed">已经读完</option></select></label></div><div id="book-grid" class="book-grid"></div><div id="more-wrap" class="more-wrap"></div></section><aside class="gentle-note"><div>' + icon('leaf') + '<p><strong>阅读像种下一颗种子。</strong><br>不必急着记住每个词，享受一起看书的时光就好。</p></div><span>Little steps, lovely things.</span></aside>';
    document.getElementById('status-filter').value = shelf.status;
    renderShelfResults();
  }

  /** 显示浏览器已经保存的学习足迹。 */
  function renderProgress() {
    var totals = Core.summary(state);
    var started = books.filter(function (book) { return Boolean(state.progress[book.id]); }).sort(function (a, b) { return state.progress[b.id].updatedAt - state.progress[a.id].updatedAt; });
    main.innerHTML = '<section class="progress-hero"><div><div class="eyebrow">GROW A LITTLE, EVERY DAY</div><h1>每一步，都算数。</h1><p>那些读过的小故事，都变成了成长的养分。</p></div><div class="progress-stats"><div class="progress-stat"><b>' + totals.started + '</b><span>本开始探索</span></div><div class="progress-stat"><b>' + totals.completed + '</b><span>本完整阅读</span></div><div class="progress-stat"><b>' + totals.stars + '</b><span>颗小星星</span></div></div></section><div class="section-heading"><div><h2>' + icon('leaf') + '我的阅读足迹</h2></div><a class="text-link" href="#library">去书架选一本</a></div><div class="progress-options"><button class="button secondary small" type="button" data-action="export">' + icon('download') + '导出进度</button><button class="button secondary small" type="button" data-action="import">' + icon('upload') + '导入进度</button></div><p class="progress-help">记录保存在当前浏览器。换设备或清理浏览器前，可以先导出一份备份。</p><div class="book-grid">' + (started.length ? started.map(bookCard).join('') : '<div class="empty-state"><img src="./assets/sprout.svg" alt="" width="60" height="60" style="margin:0 auto"><h3>你的第一颗阅读种子，还在等你</h3><p>读一本喜欢的绘本，足迹就会留在这里。</p><a class="button primary" href="#library">去找一本绘本 ' + icon('arrow') + '</a></div>') + '</div>';
  }

  /** 构造单词可点读的大字号原句，标点保持原样。 */
  function sentenceMarkup(text) {
    return text.split(/(\s+)/).map(function (part) {
      if (!part.trim()) return escapeHtml(part);
      return '<button class="sentence-word" type="button" data-action="speak" data-text="' + escapeHtml(part) + '" aria-label="设备朗读 ' + escapeHtml(part) + '">' + escapeHtml(part) + '</button>';
    }).join('');
  }

  /** 展示原图、大字号原文、整本音频和词卡。 */
  function renderReader(book, pageNumber) {
    currentBook = book;
    shelf.level = book.level;
    currentPage = Math.max(1, Math.min(book.pages.length, pageNumber));
    var page = book.pages[currentPage - 1];
    Core.recordProgress(state, book, currentPage, false, 0);
    saveState();
    prepareAudio(book);
    main.innerHTML = '<a class="back-link" href="#library">' + icon('back') + '回到小书架</a><div class="reader-heading"><div><h1 lang="en">' + escapeHtml(book.title) + '</h1><p>' + escapeHtml(book.chineseTitle) + ' <span class="footer-dot">·</span> ' + escapeHtml(book.level) + ' 启蒙绘本</p></div><div class="reader-actions"><button type="button" data-action="toggle-hints" aria-pressed="' + state.settings.hints + '" class="' + (state.settings.hints ? 'selected' : '') + '">中文提示</button><button type="button" data-action="font-cycle" aria-label="调整正文字号，当前 ' + state.settings.fontSize + ' 像素">Aa 字号</button><button type="button" data-action="original">原版页面</button>' + (book.parentCards && book.parentCards.length ? '<button type="button" data-action="parent-card">家长测试卡</button>' : '') + '</div></div><div class="reading-layout"><section class="reading-book" aria-label="绘本阅读"><div class="reader-progress" aria-hidden="true"><span style="width:' + (currentPage / book.pages.length * 100) + '%"></span></div><div class="reading-page"><div class="page-topline"><span class="level-pill"><b>' + escapeHtml(book.level) + '</b> READ & GROW</span><span>第 ' + currentPage + ' / ' + book.pages.length + ' 页</span></div><div class="picture-stage"><img src="' + page.art + '" alt="' + escapeHtml(page.text) + ' 的原版绘本插图"></div><p class="reading-sentence" lang="en">' + sentenceMarkup(page.text) + '</p><p class="hint-line"' + (state.settings.hints ? '' : ' hidden') + '>' + hintText(page) + '</p></div><div class="page-controls"><button class="button secondary" type="button" data-action="previous-page"' + (currentPage === 1 ? ' disabled' : '') + '>' + icon('back') + '上一页</button><div class="page-dots" role="group" aria-label="选择页码">' + book.pages.map(function (item, index) { return '<button class="page-dot' + (index + 1 === currentPage ? ' current' : '') + '" type="button" data-action="go-page" data-page="' + (index + 1) + '" aria-label="第 ' + (index + 1) + ' 页"' + (index + 1 === currentPage ? ' aria-current="page"' : '') + '></button>'; }).join('') + '</div><button id="quick-audio" class="reader-quick-audio" type="button" data-action="audio-toggle" aria-label="听整本原音"' + (!book.audio ? ' disabled' : '') + '>' + icon('headphones') + '</button><button class="button primary" type="button" data-action="next-page">' + (currentPage === book.pages.length ? '完成阅读' : '下一页') + icon('arrow') + '</button></div></section><aside class="learning-sidebar"><section class="side-card"><h2>' + icon('headphones') + '听听原版声音</h2><p>先听一听，再跟着说一说。</p><button id="audio-toggle" class="button primary listen-button" type="button" data-action="audio-toggle"' + (!book.audio ? ' disabled' : '') + '></button><label class="sr-only" for="audio-seek">整本音频播放位置</label><input id="audio-seek" class="audio-seek" type="range" min="0" max="' + (book.duration || 100) + '" value="0" step="0.1" aria-label="整本音频播放位置"' + (!book.audio ? ' disabled' : '') + '><div class="time-row"><span id="audio-current">0:00</span><span id="audio-duration">' + formatTime(book.duration) + '</span></div><div class="audio-settings"><button type="button" data-action="audio-restart"' + (!book.audio ? ' disabled' : '') + '>' + icon('repeat') + '再听一遍</button><select id="audio-speed" aria-label="音频播放速度">' + Core.SPEEDS.map(function (speed) { return '<option value="' + speed + '">' + speed + '×</option>'; }).join('') + '</select></div><p class="audio-explanation">原音为整本播放，可自由翻页。<br>点击英文单词可使用设备发音。</p></section><section class="side-card vocab-card"><h2>' + icon('leaf') + '认识新朋友</h2><p>点一点这些词，听听它们的名字。</p><div class="word-list">' + book.words.slice(0, 12).map(function (word) { return '<button class="word-chip" type="button" data-action="speak" data-text="' + escapeHtml(word.word) + '"><span lang="en">' + escapeHtml(word.word) + '</span><small' + (state.settings.hints ? '' : ' hidden') + '>' + escapeHtml(word.meaning) + '</small></button>'; }).join('') + '</div>' + (book.quizEnabled === false ? '' : '<a class="text-link" href="#practice/' + book.id + '" style="font-size:15px">已经读过？去玩小练习 ' + icon('arrow') + '</a>') + '</section></aside></div><p class="reader-footnote">' + escapeHtml(book.credits) + ' <span class="footer-dot">·</span> <button class="text-link" type="button" data-action="credits">查看原版封面与来源</button></p>';
    document.getElementById('audio-speed').value = String(state.settings.speed);
    updateAudioUi();
    preloadNext(book, currentPage);
  }

  /** 中文辅助使用经过筛选的关键词释义，不冒充原版译文。 */
  function hintText(page) {
    return page.words.length ? page.words.map(function (word) { return escapeHtml(word.word) + ' · ' + escapeHtml(word.meaning); }).join('　') : '看一看图片，和爸爸妈妈一起读一读。';
  }

  /** 提前请求相邻页插图，减轻低速网络下翻页的等待。 */
  function preloadNext(book, pageNumber) {
    if (pageNumber < book.pages.length) { var image = new Image(); image.src = book.pages[pageNumber].art; }
  }

  /** 切换绘本时停止旧声音，同一本内翻页保持整本原音连续。 */
  function prepareAudio(book) {
    if (audioBook === book.id) return;
    stopAudio();
    audioBook = book.id;
    if (book.audio) audio.src = book.audio;
    else audio.removeAttribute('src');
    audio.load();
    audio.playbackRate = state.settings.speed;
  }

  /** 离开阅读或切换资料时停止全部声音。 */
  function stopAudio() {
    audio.pause();
    if (audio.readyState) audio.currentTime = 0;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /** 将音频时间转换为孩子和家长都容易识别的分秒。 */
  function formatTime(seconds) {
    var value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  }

  /** 依据真实媒体状态更新播放按钮和进度，不模拟播放成功。 */
  function updateAudioUi() {
    var toggle = document.getElementById('audio-toggle');
    if (!toggle || !currentBook) return;
    var playing = !audio.paused && !audio.ended;
    toggle.innerHTML = icon(playing ? 'pause' : 'play') + (currentBook.audio ? (playing ? '暂停原音' : '听整本原音') : '原音暂不可用');
    toggle.setAttribute('aria-pressed', String(playing));
    var quick = document.getElementById('quick-audio');
    if (quick) {
      quick.innerHTML = icon(playing ? 'pause' : 'headphones');
      quick.setAttribute('aria-label', playing ? '暂停整本原音' : '听整本原音');
      quick.setAttribute('aria-pressed', String(playing));
    }
    var duration = Number.isFinite(audio.duration) ? audio.duration : currentBook.duration;
    var seek = document.getElementById('audio-seek');
    seek.max = String(duration || 100);
    seek.value = String(audio.currentTime || 0);
    document.getElementById('audio-current').textContent = formatTime(audio.currentTime);
    document.getElementById('audio-duration').textContent = formatTime(duration);
  }

  /** 播放失败时给出可重试提示，浏览器仍保持可手动阅读。 */
  function playAudio() {
    if (!currentBook || !currentBook.audio) { toast('这本绘本的原音暂不可用，可以先看图阅读。'); return; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    var promise = audio.play();
    if (promise && promise.catch) promise.catch(function () { toast('原音暂时没有播放成功，请检查网络后再点一次。'); updateAudioUi(); });
  }

  /** 使用设备英文语音点读，并与原版音频互斥播放。 */
  function speak(text) {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) { toast('这台设备暂不支持单词发音，可以使用整本原音。'); return; }
    audio.pause();
    var engine = window.speechSynthesis;
    engine.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = state.settings.speed * 0.9;
    var voices = engine.getVoices();
    var voice = voices.filter(function (item) { return /^en-US/i.test(item.lang); })[0] || voices.filter(function (item) { return /^en/i.test(item.lang); })[0];
    if (voice) utterance.voice = voice;
    utterance.onerror = function (event) { if (event.error !== 'interrupted' && event.error !== 'canceled') toast('设备英文发音暂不可用，请使用整本原音。'); };
    engine.speak(utterance);
  }

  /** 建立单次练习，答错后重试不增加独立正确数。 */
  function startQuiz(book) {
    shelf.level = book.level;
    if (book.quizEnabled === false) { location.hash = readUrl(book); toast('这本绘本可以和家长一起看测试卡。'); return; }
    if (!quiz || quiz.book.id !== book.id || quiz.finished) quiz = { book: book, questions: Core.buildQuestions(book), index: 0, firstTryCorrect: 0, attempted: false, answered: false, finished: false };
    renderQuiz();
  }

  /** 渲染当前看图选句题，图片不包含原文答案。 */
  function renderQuiz() {
    var question = quiz.questions[quiz.index];
    if (!question) { renderResult(quiz.book, 0); return; }
    main.innerHTML = '<div class="practice-shell"><a class="back-link" href="' + readUrl(quiz.book) + '">' + icon('back') + '回到绘本</a><header class="practice-header"><div class="eyebrow" style="justify-content:center">A LITTLE PLAY, A LITTLE GROWTH</div><h1>看一看，选一选</h1><p>' + escapeHtml(quiz.book.chineseTitle) + ' · 第 ' + (quiz.index + 1) + ' / ' + quiz.questions.length + ' 题</p></header><section class="practice-card"><div class="practice-steps" aria-hidden="true">' + quiz.questions.map(function (item, index) { return '<span class="' + (index <= quiz.index ? 'active' : '') + '"></span>'; }).join('') + '</div><img class="question-image" src="' + question.page.art + '" alt="请观察这幅绘本插图，选择对应的英文句子。"><h2 class="question-title">哪句话说的是这幅画？</h2><div class="quiz-options">' + question.options.map(function (text, index) { return '<button class="quiz-option" type="button" data-answer="' + index + '" lang="en">' + escapeHtml(text) + '</button>'; }).join('') + '</div><p id="quiz-feedback" class="quiz-feedback" role="status" aria-live="polite">慢慢看，你一定能发现。</p><div id="quiz-next" class="quiz-next"><button class="button soft small" type="button" data-action="question-listen">' + icon('volume') + '听听这句话</button></div></section></div>';
  }

  /** 对本题只记一次成绩，并在正确后开放下一题。 */
  function answerQuestion(button) {
    if (!quiz || quiz.answered) return;
    var choice = Number(button.getAttribute('data-answer'));
    var question = quiz.questions[quiz.index];
    var feedback = document.getElementById('quiz-feedback');
    if (choice !== question.correctIndex) {
      quiz.attempted = true;
      button.classList.add('wrong');
      button.disabled = true;
      feedback.textContent = '再看看图，试试另一个答案。';
      return;
    }
    if (!quiz.attempted) quiz.firstTryCorrect += 1;
    quiz.answered = true;
    button.classList.add('correct');
    Array.prototype.forEach.call(document.querySelectorAll('[data-answer]'), function (item) { item.disabled = true; });
    feedback.textContent = '找到了！你观察得真仔细。';
    document.getElementById('quiz-next').innerHTML = '<button class="button primary" type="button" data-action="quiz-next">' + (quiz.index + 1 === quiz.questions.length ? '收下我的小星星' : '下一题') + icon('arrow') + '</button>';
    document.querySelector('[data-action="quiz-next"]').focus();
  }

  /** 完成练习时保留最好成绩，阅读与星星都按绘本去重。 */
  function finishQuiz() {
    var stars = Core.earnedStars(quiz.firstTryCorrect, quiz.questions.length);
    quiz.finished = true;
    Core.recordProgress(state, quiz.book, quiz.book.pages.length, true, stars);
    saveState();
    renderResult(quiz.book, stars);
  }

  /** 显示轻量奖励，鼓励继续阅读而非追逐分数。 */
  function renderResult(book, stars) {
    var next = books[books.indexOf(book) + 1];
    main.innerHTML = '<div class="practice-shell"><a class="back-link" href="#library">' + icon('back') + '回到小书架</a><section class="result-card"><img class="result-plant" src="./assets/sprout.svg" alt="成长的小芽" width="80" height="80" style="margin:0 auto"><div class="result-stars" aria-label="获得 ' + stars + ' 颗星星">' + [1, 2, 3].map(function (number) { return '<span' + (number > stars ? ' class="unearned"' : '') + '>★</span>'; }).join('') + '</div><h1>又长出一片小叶子！</h1><p>你读完了《' + escapeHtml(book.chineseTitle) + '》。<br>每一次认真观察，都让小芽长大一点点。</p><div class="result-buttons">' + (next ? '<a class="button primary" href="' + readUrl(next) + '">再读一本 ' + icon('arrow') + '</a>' : '<a class="button primary" href="#library">回书架选一本 ' + icon('arrow') + '</a>') + '<button class="button secondary" type="button" data-action="retry-quiz" data-id="' + book.id + '">' + icon('repeat') + '再玩一次</button><a class="button soft" href="#progress">看看我的足迹</a></div></section></div>';
    window.scrollTo(0, 0);
  }

  /** 创建可键盘操作的模态框，并将焦点转入其中。 */
  function openModal(title, body, wide) {
    lastFocus = document.activeElement;
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-overlay"><section class="modal-panel' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-heading"><h2 id="modal-title">' + escapeHtml(title) + '</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭窗口">' + icon('close') + '</button></div><div class="modal-body">' + body + '</div></section></div>';
    document.body.style.overflow = 'hidden';
    // Chrome 77 支持 inert 之前，使用 aria-hidden 与焦点约束隔离背景。
    main.setAttribute('aria-hidden', 'true');
    document.querySelector('.site-header').setAttribute('aria-hidden', 'true');
    document.querySelector('.site-footer').setAttribute('aria-hidden', 'true');
    root.querySelector('.modal-close').focus();
  }

  /** 关闭窗口并恢复打开前的控件焦点。 */
  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    document.body.style.overflow = '';
    main.removeAttribute('aria-hidden');
    document.querySelector('.site-header').removeAttribute('aria-hidden');
    document.querySelector('.site-footer').removeAttribute('aria-hidden');
    pendingImport = null;
    if (lastFocus && document.documentElement.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  /** 显示阅读设置和进度备份入口。 */
  function showSettings() {
    openModal('一起把阅读调舒服', '<p>字大一点，节奏慢一点，让孩子按自己的步子读。</p><section class="setting-group"><h3>英文正文字号</h3><p>绘本中的句子会跟随调整。</p><div class="setting-buttons" role="group" aria-label="正文字号">' + Core.FONT_SIZES.map(function (size, index) { return '<button type="button" data-font="' + size + '" aria-pressed="' + (state.settings.fontSize === size) + '" class="' + (state.settings.fontSize === size ? 'selected' : '') + '">' + ['大字', '更大', '特大'][index] + ' · ' + size + '</button>'; }).join('') + '</div></section><section class="setting-group"><h3>中文辅助</h3><p>需要时显示关键词释义，鼓励先看图理解。</p><div class="setting-buttons" role="group" aria-label="中文辅助"><button type="button" data-hints="false" aria-pressed="' + !state.settings.hints + '" class="' + (!state.settings.hints ? 'selected' : '') + '">先看图读英语</button><button type="button" data-hints="true" aria-pressed="' + state.settings.hints + '" class="' + (state.settings.hints ? 'selected' : '') + '">显示中文提示</button></div></section><section class="setting-group"><h3>原音播放速度</h3><div class="setting-buttons" role="group" aria-label="原音速度">' + Core.SPEEDS.map(function (speed) { return '<button type="button" data-speed="' + speed + '" aria-pressed="' + (state.settings.speed === speed) + '" class="' + (state.settings.speed === speed ? 'selected' : '') + '">' + (speed === 0.75 ? '慢一点' : speed === 1 ? '正常速度' : '快一点') + '</button>'; }).join('') + '</div></section><section class="setting-group"><h3>保存成长的足迹</h3><p>进度仅保存在当前浏览器，不会自动同步到其他设备。</p><div class="setting-buttons"><button class="button secondary" type="button" data-action="export">' + icon('download') + '导出进度</button><button class="button secondary" type="button" data-action="import">' + icon('upload') + '导入进度</button></div></section><p class="settings-bottom">建议每天读一小本，和孩子一起看图、说话。适时远眺和休息。</p>');
  }

  /** 同步设置控件选中态，避免关闭并重建窗口打断键盘操作。 */
  function syncSettingButtons(attribute, value) {
    Array.prototype.forEach.call(document.querySelectorAll('[' + attribute + ']'), function (button) {
      var selected = button.getAttribute(attribute) === String(value);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  /** 调整中文词义显示，不中断当前原音或翻页位置。 */
  function setHints(value) {
    state.settings.hints = value;
    saveState();
    var hint = document.querySelector('.hint-line');
    if (hint) hint.hidden = !value;
    Array.prototype.forEach.call(document.querySelectorAll('.word-chip small'), function (item) { item.hidden = !value; });
    var toggle = document.querySelector('[data-action="toggle-hints"]');
    if (toggle) { toggle.classList.toggle('selected', value); toggle.setAttribute('aria-pressed', String(value)); }
    syncSettingButtons('data-hints', value);
  }

  /** 导出可在另一台设备重新导入的完整学习档案。 */
  function exportProgress() {
    var data = JSON.parse(JSON.stringify(state));
    data.exportedAt = new Date().toISOString();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'little-sprout-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('进度备份已准备好，请妥善保存下载的 JSON 文件。');
  }

  /** 读取用户选择的备份，验证后先展示替换结果。 */
  function importProgress() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      if (file.size > MAX_BACKUP_BYTES) { toast('备份文件过大，请选择小芽阅读导出的 JSON 文件。'); input.remove(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var restored = Core.validateState(JSON.parse(reader.result), books);
          var totals = Core.summary(restored);
          openModal('导入这份阅读足迹？', '<p>这份备份包含 <strong>' + totals.started + '</strong> 本阅读记录、<strong>' + totals.completed + '</strong> 本已读绘本和 <strong>' + totals.stars + '</strong> 颗星星。</p><p>导入会替换当前浏览器的学习记录和阅读设置。需要保留当前记录时，请先导出备份。</p><div class="modal-buttons"><button class="button secondary" type="button" data-action="close-modal">暂不导入</button><button class="button primary" type="button" data-action="confirm-import">替换并导入</button></div>');
          pendingImport = restored;
        } catch (error) { toast(error.message || '无法读取备份，请选择正确的 JSON 文件。'); }
      };
      reader.onerror = function () { toast('备份文件读取失败，请重新选择。'); };
      reader.readAsText(file, 'UTF-8');
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  /** 展示原版页面或出版信息，保留来源而不修改原文。 */
  function showOriginal(creditsOnly) {
    if (!currentBook) return;
    var images = creditsOnly ? currentBook.sourcePages : [currentBook.pages[currentPage - 1].image];
    openModal(creditsOnly ? '原版封面与出版信息' : '原版绘本 · 第 ' + currentPage + ' 页', '<p class="credit-label">' + escapeHtml(currentBook.credits) + '</p><div class="source-images">' + images.map(function (path) { return '<img src="' + path + '" alt="' + escapeHtml(currentBook.title) + ' 原版页面">'; }).join('') + '</div>', true);
  }

  /** 展示与当前绘本匹配的原版家长测试卡。 */
  function showParentCard() {
    if (!currentBook || !currentBook.parentCards || !currentBook.parentCards.length) return;
    var book = currentBook;
    openModal('家长测试卡 · ' + book.title, '<p>结合绘本内容，和孩子一起聊一聊。</p><p class="credit-label">' + escapeHtml(book.credits) + '</p><div class="source-images">' + book.parentCards.map(function (path) { return '<img src="' + path + '" alt="' + escapeHtml(book.title) + ' 原版测试卡">'; }).join('') + '</div>', true);
  }

  /** 解释素材核验结果与离线存储边界。 */
  function showAbout() {
    openModal('关于这座小书架', '<p>小芽阅读面向刚开始接触英语的孩子。先看图，再听一听、读一读，最后玩一个小练习。</p><h3>绘本与声音</h3><p>当前收录 ' + books.length + ' 本经内容核实的 AA、A 级绘本，共 ' + books.reduce(function (total, book) { return total + book.pages.length; }, 0) + ' 个阅读页面。英文原文与插图来自所提供资料，原版出版信息可在阅读页查看。中文书名、词义提示和练习为学习辅助。</p><p>源资料编号 100 的 PDF 实际为 H 级《Cinderella》，与文件名不符，因此未混入 AA 书架。其对应 AA 绘本待获得正确文件后补充。A 级《Fruits》《I Go》在绘本目录使用 Benchmark 编号，音频编号 100 的《I Push》缺少对应绘本；部分 Benchmark 绘本没有对应测试卡。</p><h3>音频与进度</h3><p>“听整本原音”播放本地保存的原版音频；单词点读使用设备英文语音，是否可用取决于浏览器与系统。</p><p>无需登录。学习进度仅保存在当前浏览器，换设备前请导出备份，再在新设备导入。GitHub Pages 不提供自动同步。</p><p class="credit-label">© Learning A–Z · www.readinga-z.com</p>');
  }

  /** 统一处理哈希路由，刷新深层链接也能直接打开。 */
  function route() {
    if (document.querySelector('.modal-overlay')) closeModal();
    var parts = location.hash.slice(1).split('/');
    var view = parts[0] || 'library';
    var book = parts[1] && Object.prototype.hasOwnProperty.call(bookIndex, parts[1]) ? bookIndex[parts[1]] : null;
    if (view !== 'read') { stopAudio(); currentBook = null; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (link) {
      var active = link.getAttribute('data-nav') === (view === 'progress' ? 'progress' : 'library');
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (view === 'read' && book) {
      quiz = null;
      var requestedPage = Number(parts[2]);
      renderReader(book, Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
      document.title = book.title + ' · 小芽阅读';
    } else if (view === 'practice' && book) {
      startQuiz(book);
      document.title = '小练习 · ' + book.title + ' · 小芽阅读';
    } else if (view === 'progress') {
      quiz = null;
      renderProgress();
      document.title = '我的足迹 · 小芽阅读';
    } else {
      if (view !== 'library') { stopAudio(); currentBook = null; toast('这本绘本暂时没找到，先看看小书架吧。'); }
      quiz = null;
      renderLibrary();
      document.title = '小芽阅读 · 每天一个小小的世界';
    }
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  /** 分发界面操作，始终从实际控件读取业务目标。 */
  function handleClick(event) {
    var target = event.target.closest('button, a');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-level')) {
      shelf.level = target.getAttribute('data-level'); shelf.category = 'all'; shelf.search = ''; shelf.status = 'all'; shelf.limit = PAGE_SIZE; renderLibrary();
      document.querySelector('[data-level="' + shelf.level + '"]').focus(); return;
    }
    if (target.hasAttribute('data-category')) {
      shelf.category = target.getAttribute('data-category'); shelf.limit = PAGE_SIZE; renderShelfResults(); return;
    }
    if (target.hasAttribute('data-font')) {
      state.settings.fontSize = Number(target.getAttribute('data-font')); applySettings(); saveState(); syncSettingButtons('data-font', state.settings.fontSize); return;
    }
    if (target.hasAttribute('data-hints')) { setHints(target.getAttribute('data-hints') === 'true'); return; }
    if (target.hasAttribute('data-speed')) {
      state.settings.speed = Number(target.getAttribute('data-speed')); applySettings(); saveState(); syncSettingButtons('data-speed', state.settings.speed);
      var speedSelect = document.getElementById('audio-speed'); if (speedSelect) speedSelect.value = String(state.settings.speed); return;
    }
    if (target.hasAttribute('data-answer')) { answerQuestion(target); return; }
    var action = target.getAttribute('data-action');
    if (!action) return;
    if (action === 'settings') showSettings();
    else if (action === 'close-modal') closeModal();
    else if (action === 'about') showAbout();
    else if (action === 'export') exportProgress();
    else if (action === 'import') importProgress();
    else if (action === 'confirm-import' && pendingImport) {
      state = pendingImport; closeModal(); canStore = true; document.getElementById('storage-notice').hidden = true; saveState(); applySettings(); quiz = null; route(); toast('阅读足迹已导入。');
    } else if (action === 'load-more') {
      var firstNewIndex = shelf.limit; shelf.limit += PAGE_SIZE; renderShelfResults();
      var newLink = document.querySelectorAll('#book-grid .cover-link')[firstNewIndex]; if (newLink) newLink.focus();
    } else if (action === 'reset-filters') {
      shelf = { level: shelf.level, category: 'all', search: '', status: 'all', limit: PAGE_SIZE }; renderLibrary(); document.getElementById('book-search').focus();
    } else if (action === 'toggle-hints') setHints(!state.settings.hints);
    else if (action === 'font-cycle') {
      state.settings.fontSize = Core.FONT_SIZES[(Core.FONT_SIZES.indexOf(state.settings.fontSize) + 1) % Core.FONT_SIZES.length]; applySettings(); saveState(); target.setAttribute('aria-label', '调整正文字号，当前 ' + state.settings.fontSize + ' 像素'); toast('正文字号已调到 ' + state.settings.fontSize + '。');
    } else if (action === 'previous-page' && currentBook && currentPage > 1) location.hash = readUrl(currentBook, currentPage - 1);
    else if (action === 'go-page' && currentBook) location.hash = readUrl(currentBook, Number(target.getAttribute('data-page')));
    else if (action === 'next-page' && currentBook) {
      if (currentPage < currentBook.pages.length) location.hash = readUrl(currentBook, currentPage + 1);
      else { Core.recordProgress(state, currentBook, currentPage, true, 0); saveState(); if (currentBook.quizEnabled === false) { location.hash = '#progress'; toast('已读完这本绘本。'); } else location.hash = '#practice/' + currentBook.id; }
    } else if (action === 'audio-toggle') { if (audio.paused || audio.ended) playAudio(); else audio.pause(); }
    else if (action === 'audio-restart') { if (audio.readyState) audio.currentTime = 0; playAudio(); }
    else if (action === 'speak') speak(target.getAttribute('data-text'));
    else if (action === 'question-listen' && quiz) { quiz.attempted = true; speak(quiz.questions[quiz.index].page.text); }
    else if (action === 'quiz-next' && quiz && quiz.answered) {
      if (quiz.index + 1 === quiz.questions.length) finishQuiz();
      else { quiz.index += 1; quiz.answered = false; quiz.attempted = false; renderQuiz(); main.focus(); }
    } else if (action === 'retry-quiz') { quiz = null; startQuiz(bookIndex[target.getAttribute('data-id')]); }
    else if (action === 'original') showOriginal(false);
    else if (action === 'parent-card') showParentCard();
    else if (action === 'credits') showOriginal(true);
  }

  /** 模态框约束焦点，阅读页支持左右键，输入框中不拦截光标。 */
  function handleKeydown(event) {
    var dialog = document.querySelector('.modal-panel');
    if (dialog) {
      if (event.key === 'Escape') { closeModal(); return; }
      if (event.key === 'Tab') {
        var controls = Array.prototype.filter.call(dialog.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]'), function (item) { return !item.hidden && item.offsetParent !== null; });
        var first = controls[0]; var last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (!currentBook || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'ArrowRight' && currentPage < currentBook.pages.length) { event.preventDefault(); location.hash = readUrl(currentBook, currentPage + 1); }
    if (event.key === 'ArrowLeft' && currentPage > 1) { event.preventDefault(); location.hash = readUrl(currentBook, currentPage - 1); }
  }

  loadState();
  applySettings();
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('input', function (event) {
    if (event.target.id === 'book-search') { shelf.search = event.target.value; shelf.limit = PAGE_SIZE; renderShelfResults(); }
    if (event.target.id === 'audio-seek' && audio.readyState && Number.isFinite(audio.duration)) { audio.currentTime = Number(event.target.value); updateAudioUi(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target.id === 'status-filter') { shelf.status = event.target.value; shelf.limit = PAGE_SIZE; renderShelfResults(); }
    if (event.target.id === 'audio-speed') { state.settings.speed = Number(event.target.value); applySettings(); saveState(); }
  });
  document.getElementById('modal-root').addEventListener('click', function (event) { if (event.target.classList.contains('modal-overlay')) closeModal(); });
  ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach(function (name) { audio.addEventListener(name, updateAudioUi); });
  audio.addEventListener('error', function () { if (currentBook && currentBook.audio) toast('原音文件暂时无法加载，请检查网络或素材文件是否齐全。'); updateAudioUi(); });
  // 图片加载失败时显式提示，不用看似正常的占位图掩盖素材问题。
  document.addEventListener('error', function (event) {
    if (event.target.tagName === 'IMG') { event.target.alt = '图片暂未加载，请检查网络后刷新。'; event.target.classList.add('error-image-note'); }
  }, true);
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', function () { stopAudio(); saveState(); });
  route();
}());
