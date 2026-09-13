/* 文章包导入的纯逻辑自测：node test-import.js */
'use strict';

var assert = require('assert');
var Importer = require('./import-package.js');

var passed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ✓ ' + label); }
  catch (error) { console.error('  ✗ ' + label + ' — ' + error.message); process.exitCode = 1; }
}

console.log('pathKeys');
check('平路径拆出文件名', function () {
  assert.deepStrictEqual(Importer.pathKeys('img/a.png'), ['img/a.png', 'a.png']);
});
check('带顶层目录时拆到最里层', function () {
  assert.deepStrictEqual(Importer.pathKeys('article/img/a.png'), ['article/img/a.png', 'img/a.png', 'a.png']);
});
check('尖括号、反斜杠、./ 都归一化', function () {
  assert.deepStrictEqual(Importer.pathKeys('<.\\img\\a.PNG>'), ['img/a.png', 'a.png']);
});
check('URL 编码过的中文名还原', function () {
  assert.deepStrictEqual(Importer.pathKeys('%E5%9B%BE/%E4%B8%80.png'), ['图/一.png', '一.png']);
});
check('空值返回空数组', function () {
  assert.deepStrictEqual(Importer.pathKeys('   '), []);
});

var map = {};
Importer.pathKeys('article/img/a.png').forEach(function (key) { map[key] = 'data:image/png;base64,AAA'; });
Importer.pathKeys('article/img/b.jpg').forEach(function (key) { map[key] = 'data:image/jpeg;base64,BBB'; });

console.log('rewriteImageRefs');
check('相对路径命中并换成内联图片', function () {
  var out = Importer.rewriteImageRefs('正文\n\n![图](img/a.png)\n', map);
  assert.strictEqual(out.missing.length, 0);
  assert.strictEqual(out.text, '正文\n\n![图](data:image/png;base64,AAA)\n');
});
check('保留标题写法', function () {
  var out = Importer.rewriteImageRefs('![图](img/a.png "说明")', map);
  assert.strictEqual(out.text, '![图](data:image/png;base64,AAA "说明")');
});
check('尖括号包裹的路径', function () {
  var out = Importer.rewriteImageRefs('![](<img/b.jpg>)', map);
  assert.strictEqual(out.text, '![](data:image/jpeg;base64,BBB)');
});
check('Obsidian 双链（含尺寸）', function () {
  var out = Importer.rewriteImageRefs('![[img/a.png|600]]', map);
  assert.strictEqual(out.text, '![](data:image/png;base64,AAA)');
});
check('手写 img 标签', function () {
  var out = Importer.rewriteImageRefs('<img src="img/b.jpg" alt="x">', map);
  assert.strictEqual(out.text, '<img src="data:image/jpeg;base64,BBB" alt="x">');
});
check('外链图片不动，也不算缺失', function () {
  var out = Importer.rewriteImageRefs('![x](https://a.com/b.png)', map);
  assert.strictEqual(out.text, '![x](https://a.com/b.png)');
  assert.strictEqual(out.missing.length, 0);
});
check('已经是内联图片的不重复处理', function () {
  var inline = '![x](data:image/png;base64,ZZZ)';
  var out = Importer.rewriteImageRefs(inline, map);
  assert.strictEqual(out.text, inline);
  assert.strictEqual(out.missing.length, 0);
});
check('匹配不到的记进 missing 且原样保留', function () {
  var out = Importer.rewriteImageRefs('![](img/none.png)', map);
  assert.strictEqual(out.text, '![](img/none.png)');
  assert.deepStrictEqual(out.missing, ['img/none.png']);
});
check('代码块里的图片语法也照换（与线上行为一致）', function () {
  var out = Importer.rewriteImageRefs('```\n![图](img/a.png)\n```', map);
  assert.ok(out.text.indexOf('data:image/png;base64,AAA') !== -1);
});

console.log('pickDocument');
function fakeFile(name, size) { return { name: name, size: size }; }
check('没有文稿返回 null', function () {
  assert.strictEqual(Importer.pickDocument([fakeFile('a.png', 10)]), null);
});
check('多篇文稿时挑最大的一篇', function () {
  var doc = Importer.pickDocument([fakeFile('a.md', 10), fakeFile('b.md', 999), fakeFile('x.png', 5000)]);
  assert.strictEqual(doc.name, 'b.md');
});
check('有正文时跳过 README', function () {
  var doc = Importer.pickDocument([fakeFile('README.md', 9000), fakeFile('文章.md', 100)]);
  assert.strictEqual(doc.name, '文章.md');
});
check('只有 README 时也用它', function () {
  var doc = Importer.pickDocument([fakeFile('README.md', 9000)]);
  assert.strictEqual(doc.name, 'README.md');
});
check('识别扩展名', function () {
  assert.strictEqual(Importer.isTextFile(fakeFile('a.MARKDOWN', 1)), true);
  assert.strictEqual(Importer.isImageFile(fakeFile('a.WEBP', 1)), true);
  assert.strictEqual(Importer.isImageFile(fakeFile('a.zip', 1)), false);
});

console.log('\n通过 ' + passed + ' 项');
if (process.exitCode) console.error('有失败项');