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
const library = context.window.RAZ_LIBRARY;

/** 校验资源使用仓库内相对路径且文件真实存在。 */
function verifyResource(relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(!relative.startsWith('/') && !relative.includes('..') && !relative.includes('://'), relative);
  const file = path.join(root, relative);
  assert.ok(fs.existsSync(file), '缺少资源：' + relative);
  assert.ok(fs.statSync(file).size > 100, '资源文件过小：' + relative);
}

test('99 本 AA 绘本保留真实页数，错误标记的 H 级文件被隔离', () => {
  assert.equal(library.books.length, 99);
  assert.equal(new Set(library.books.map(book => book.id)).size, 99);
  assert.equal(library.books.reduce((count, book) => count + book.pages.length, 0), 794);
  assert.equal(library.books.some(book => book.number === 100), false);
  assert.equal(library.issues.length, 1);
  assert.match(library.issues[0].reason, /H/);
  library.books.forEach(book => {
    assert.equal(book.level, 'AA');
    assert.equal(book.pages.length, book.number === 72 ? 10 : 8);
    assert.equal(book.sourcePages.length, 2);
    assert.ok(book.words.length > 0);
    assert.match(book.credits, /Learning A/);
  });
});

test('全部封面、原页、练习图与 99 个原音均存在且使用相对路径', () => {
  library.books.forEach(book => {
    verifyResource(book.cover);
    verifyResource(book.audio);
    book.sourcePages.forEach(verifyResource);
    assert.ok(book.duration > 0);
    book.pages.forEach((page, index) => {
      verifyResource(page.image);
      verifyResource(page.art);
      assert.equal(page.number, index + 1);
      assert.ok(page.text.length > 2 && page.text.length < 150, page.text);
      assert.doesNotMatch(page.text, /Level aa|reading[a-]z|Correlation|Word Count/i);
      assert.doesNotMatch(page.text, /\s+[.!?,]/, '原句标点不应被零宽空格拆开');
    });
  });
});

test('倒置拼版中的分段原文按转正后的阅读顺序提取', () => {
  const book = library.books.find(item => item.number === 96);
  assert.equal(book.pages[1].text, 'Out of the wagon.');
  assert.equal(book.pages[5].text, 'Out of the grass.');
  assert.equal(book.pages[7].text, 'Out of the bathtub.');
});

test('每本都能生成三道无重复选项的小练习', () => {
  library.books.forEach(book => {
    const questions = Core.buildQuestions(book);
    assert.equal(questions.length, 3, book.title);
    questions.forEach(question => {
      assert.notEqual(question.options[0], question.options[1], book.title);
      assert.equal(question.options[question.correctIndex], question.page.text);
    });
  });
});

test('重要兼容约束不依赖新语法或现代布局', () => {
  ['app.js', 'core.js'].forEach(file => {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(code, /\?\.|\?\?|\.replaceAll\(/, file);
  });
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'styles.css'), 'utf8'), /backdrop-filter|\bsubgrid\b|\baspect-ratio\s*:/);
});
