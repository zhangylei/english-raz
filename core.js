(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SproutCore = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  /** 当前备份格式版本，变更结构时必须同步迁移校验。 */
  var VERSION = 1;
  /** 学习数据使用独立存储键，避免覆盖同域其他网站的记录。 */
  var STORAGE_KEY = 'little-sprout-raz-v1';
  /** 三档大字号适合儿童近距离阅读。 */
  var FONT_SIZES = [36, 44, 52];
  /** 音频速率只提供少量易理解的选项。 */
  var SPEEDS = [0.75, 1, 1.25];
  /** 允许备份设备最多一天的时钟偏差，拒绝明显异常的未来记录。 */
  var CLOCK_TOLERANCE = 24 * 60 * 60 * 1000;

  /** 创建与其他访问者隔离的空白本地档案。 */
  function initialState() {
    return { version: VERSION, settings: { fontSize: 36, hints: false, speed: 1 }, progress: {}, lastBook: null };
  }

  /** 判断值是否为可用的普通对象。 */
  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  /** 校验并复制备份，拒绝未知书目、越界页码及损坏的学习记录。 */
  function validateState(value, books) {
    if (!isObject(value) || value.version !== VERSION || !isObject(value.settings) || !isObject(value.progress)) throw new Error('这不是可识别的小芽阅读备份。');
    var result = initialState();
    var settings = value.settings;
    if (FONT_SIZES.indexOf(settings.fontSize) === -1 || SPEEDS.indexOf(settings.speed) === -1 || typeof settings.hints !== 'boolean') throw new Error('备份中的阅读设置无效。');
    result.settings = { fontSize: settings.fontSize, hints: settings.hints, speed: settings.speed };
    var index = {};
    books.forEach(function (book) { index[book.id] = book; });
    Object.keys(value.progress).forEach(function (id) {
      var entry = value.progress[id];
      var book = Object.prototype.hasOwnProperty.call(index, id) ? index[id] : null;
      if (!book || !isObject(entry) || !Number.isInteger(entry.page) || entry.page < 1 || entry.page > book.pages.length || typeof entry.completed !== 'boolean' || !Number.isInteger(entry.stars) || entry.stars < 0 || entry.stars > 3 || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0 || entry.updatedAt > Date.now() + CLOCK_TOLERANCE) throw new Error('备份中的绘本进度无效。');
      if (entry.stars && !entry.completed) throw new Error('备份中的练习与阅读状态不一致。');
      result.progress[id] = { page: entry.page, completed: entry.completed, stars: entry.stars, updatedAt: entry.updatedAt };
    });
    if (value.lastBook !== null && (!Object.prototype.hasOwnProperty.call(index, value.lastBook) || !Object.prototype.hasOwnProperty.call(result.progress, value.lastBook))) throw new Error('备份中的最近阅读记录无效。');
    result.lastBook = value.lastBook;
    return result;
  }

  /** 合并阅读位置与历史最好练习成绩。 */
  function recordProgress(state, book, page, completed, stars) {
    var old = state.progress[book.id] || { completed: false, stars: 0 };
    state.progress[book.id] = { page: Math.max(1, Math.min(book.pages.length, page)), completed: old.completed || Boolean(completed), stars: Math.max(old.stars, stars || 0), updatedAt: Date.now() };
    state.lastBook = book.id;
    return state.progress[book.id];
  }

  /** 从真实且互不重复的原文页面生成三道看图选句题。 */
  function buildQuestions(book) {
    if (book.quizEnabled === false) return [];
    var unique = [];
    book.pages.forEach(function (page) {
      if (unique.every(function (other) { return other.text !== page.text; })) unique.push(page);
    });
    if (unique.length < 2) return [];
    var positions = unique.length >= 3 ? [0, Math.floor(unique.length / 2), unique.length - 1] : [0, 1];
    return positions.map(function (position, index) {
      var page = unique[position];
      var distractor = unique[(position + 1 + index) % unique.length];
      if (distractor.text === page.text) distractor = unique[(position + 1) % unique.length];
      var correctIndex = (book.number + index) % 2;
      var options = correctIndex ? [distractor.text, page.text] : [page.text, distractor.text];
      return { page: page, options: options, correctIndex: correctIndex };
    });
  }

  /** 按独立答对的比例授星，重试答对仍能完成练习。 */
  function earnedStars(firstTryCorrect, total) {
    if (!total) return 0;
    if (firstTryCorrect === total) return 3;
    return firstTryCorrect / total >= 2 / 3 ? 2 : 1;
  }

  /** 汇总已读、进行中和奖励，重复阅读不会重复累计。 */
  function summary(state) {
    var result = { started: 0, completed: 0, stars: 0 };
    Object.keys(state.progress).forEach(function (id) {
      result.started += 1;
      if (state.progress[id].completed) result.completed += 1;
      result.stars += state.progress[id].stars;
    });
    return result;
  }

  return { VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, FONT_SIZES: FONT_SIZES, SPEEDS: SPEEDS, initialState: initialState, validateState: validateState, recordProgress: recordProgress, buildQuestions: buildQuestions, earnedStars: earnedStars, summary: summary };
}));
