'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../core.js');
const root = path.join(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'data/catalog.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(root, 'data/catalog-a.js'), 'utf8'), context);
const books = context.window.RAZ_LIBRARY.books;
const aBooks = books.filter(book => book.level === 'A');
const aaBooks = books.filter(book => book.level === 'AA');
const audio = JSON.parse(fs.readFileSync(path.join(root, 'data/audio-a-index.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'data/source-a-report.json'), 'utf8'));

/** 校验相对资源路径确实指向可部署文件。 */
function verify(relative) {
  assert.ok(relative && !relative.startsWith('/') && !relative.includes('..') && !relative.includes('://'), relative);
  assert.ok(fs.statSync(path.join(root, relative)).size > 100, relative);
}

test('AA 与 A 绘本独立保存，重复编号的 Benchmark 保留唯一 ID', () => {
  assert.equal(aaBooks.length, 99);
  assert.equal(aBooks.length, 99);
  assert.equal(new Set(books.map(book => book.id)).size, 198);
  assert.equal(aBooks.reduce((total, book) => total + book.pages.length, 0), 800);
  assert.deepEqual(report.missingNumberedSources, [28, 53, 100]);
  assert.ok(aBooks.some(book => book.id === 'a-098-benchmark' && book.title === 'Fruits'));
  assert.ok(aBooks.some(book => book.id === 'a-098' && book.title === 'This Lizard'));
  assert.ok(aBooks.some(book => book.id === 'a-099-benchmark' && book.title === 'I Go'));
  assert.ok(aBooks.some(book => book.id === 'a-099' && book.title === 'Scary, Not Scary'));
});

test('A 级正文、原音和测试卡均有可部署资源', () => {
  assert.equal(report.audioAvailable, 99);
  assert.equal(report.cardsAvailable, 97);
  aBooks.forEach(book => {
    verify(book.cover);
    verify(book.audio);
    assert.ok(book.duration > 0, book.id);
    assert.ok(book.words.length > 0, book.id);
    book.sourcePages.forEach(verify);
    book.parentCards.forEach(verify);
    if (book.parentCards.length) assert.equal(book.parentCards.length, 4, book.id);
    book.pages.forEach(page => {
      assert.ok(page.text && page.text.length < 150, book.id);
      verify(page.image);
      verify(page.art);
    });
  });
});

test('原音按标题匹配，已知错拼单独核对', () => {
  const fixes = { 'i see my colprs': 'I See My Colors', 'go fiy a kite': 'Go Fly a Kite', icn: 'I Can', snile: 'Smile' };
  const norm = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  aBooks.forEach(book => {
    const record = audio.find(item => item.id === book.id);
    assert.ok(record, book.id);
    const title = record.sourceName.replace(/^\d+\s*/, '').replace(/\.mp3$/i, '');
    assert.equal(norm(fixes[title.toLowerCase()] || title), norm(book.title), book.id);
  });
});

test('插图中的标注不会误入 My Face 和 Hot and Cold 正文', () => {
  const face = aBooks.find(book => book.id === 'a-086');
  assert.deepEqual(Array.from(face.pages.map(page => page.text)), ['This is my eye.', 'This is my eyebrow.', 'This is my ear.', 'This is my cheek.', 'This is my nose.', 'This is my mouth.', 'This is my chin.', 'This is my face.']);
  const hot = aBooks.find(book => book.id === 'a-095');
  assert.equal(hot.pages[7].text, 'Things can be hot or cold.');
  assert.equal(Core.buildQuestions(face).length, 0);
  assert.equal(Core.buildQuestions(aBooks.find(book => book.id === 'a-094')).length, 0);
  aBooks.filter(book => book.quizEnabled !== false).forEach(book => assert.equal(Core.buildQuestions(book).length, 3, book.id));
});

test('旧版 AA 备份仍能在加入 A 级后完整导入', () => {
  const aa = aaBooks[0];
  const state = Core.initialState();
  Core.recordProgress(state, aa, 4, true, 3);
  assert.deepEqual(Core.validateState(JSON.parse(JSON.stringify(state)), books), state);
  const a = aBooks[0];
  Core.recordProgress(state, a, 2, false, 0);
  assert.equal(state.progress[aa.id].stars, 3);
  assert.equal(state.progress[a.id].page, 2);
});
