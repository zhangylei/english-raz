'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const book = { id: 'aa-001', number: 1, pages: ['The dog.', 'The pig.', 'The sheep.', 'The animals.'].map((text, index) => ({ text, number: index + 1, art: 'page-' + index + '.jpg' })) };

test('学习记录保留最好成绩，重复阅读不重复累计', () => {
  const state = Core.initialState();
  Core.recordProgress(state, book, 2, false, 0);
  assert.deepEqual(Core.summary(state), { started: 1, completed: 0, stars: 0 });
  Core.recordProgress(state, book, 4, true, 3);
  Core.recordProgress(state, book, 1, false, 1);
  assert.equal(state.progress[book.id].page, 1);
  assert.equal(state.progress[book.id].completed, true);
  assert.deepEqual(Core.summary(state), { started: 1, completed: 1, stars: 3 });
});

test('阅读页码限制在真实页数内', () => {
  const state = Core.initialState();
  assert.equal(Core.recordProgress(state, book, 999, false, 0).page, 4);
  assert.equal(Core.recordProgress(state, book, -2, false, 0).page, 1);
});

test('备份恢复设置与独立进度，复制时不复用外部对象', () => {
  const state = Core.initialState();
  state.settings = { fontSize: 52, speed: 0.75, hints: true };
  Core.recordProgress(state, book, 3, true, 2);
  const restored = Core.validateState(JSON.parse(JSON.stringify(state)), [book]);
  assert.deepEqual(restored, state);
  restored.progress[book.id].page = 1;
  assert.equal(state.progress[book.id].page, 3);
});

test('拒绝未知版本、书目、越界页码与伪造星级，不修改现有档案', () => {
  const mutations = [
    value => { value.version = 2; },
    value => { value.settings.fontSize = 6; },
    value => { value.settings.hints = 'true'; },
    value => { value.settings.speed = 100; },
    value => { value.progress['unknown'] = value.progress[book.id]; },
    value => { value.progress[book.id].page = 999; },
    value => { value.progress[book.id].stars = 99; },
    value => { value.progress[book.id].completed = false; },
    value => { value.progress[book.id].updatedAt = Date.now() + 86400000 * 3; },
    value => { value.lastBook = 'unknown'; },
    value => { value.progress = []; }
  ];
  const original = Core.initialState();
  Core.recordProgress(original, book, 4, true, 3);
  mutations.forEach(mutate => {
    const input = JSON.parse(JSON.stringify(original));
    mutate(input);
    assert.throws(() => Core.validateState(input, [book]));
    assert.equal(original.progress[book.id].stars, 3);
  });
  assert.throws(() => Core.validateState(null, [book]));
  assert.throws(() => Core.validateState({}, [book]));
});

test('练习使用真实原句，重复页不会生成重复选项', () => {
  const repeated = Object.assign({}, book, { pages: book.pages.concat(book.pages[0]) });
  const questions = Core.buildQuestions(repeated);
  assert.equal(questions.length, 3);
  assert.equal(new Set(questions.map(question => question.page.text)).size, 3);
  questions.forEach(question => {
    assert.equal(question.options.length, 2);
    assert.notEqual(question.options[0], question.options[1]);
    assert.equal(question.options[question.correctIndex], question.page.text);
    question.options.forEach(option => assert.ok(book.pages.some(page => page.text === option)));
  });
  assert.deepEqual(Core.buildQuestions({ number: 1, pages: [book.pages[0], book.pages[0]] }), []);
});

test('独立答对与辅助重试分别授星', () => {
  assert.equal(Core.earnedStars(3, 3), 3);
  assert.equal(Core.earnedStars(2, 3), 2);
  assert.equal(Core.earnedStars(1, 3), 1);
  assert.equal(Core.earnedStars(0, 3), 1);
  assert.equal(Core.earnedStars(0, 0), 0);
});
