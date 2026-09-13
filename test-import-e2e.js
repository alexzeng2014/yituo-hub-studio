/* 导入文章包的端到端冒烟：在 jsdom 里真的启动 studio.html，
 * 造一个「文章包」丢给 input，看正文和内联图片有没有落到位。 node test-import-e2e.js
 */
'use strict';

const path = require('path');
const { JSDOM } = require('jsdom');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let fail = false;

function report(label, ok, detail) {
  console.log(label + ' ' + (ok ? 'PASS' : 'FAIL') + (detail ? ' ' + detail : ''));
  if (!ok) fail = true;
}

function wait(window, ms) {
  return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

function makeFile(window, bytes, name, type, relativePath) {
  const file = new window.File([bytes], name, { type: type });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true });
  return file;
}

async function main() {
  const dom = await JSDOM.fromFile(path.join(__dirname, 'studio.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const window = dom.window;
  await new Promise(function (resolve) { window.addEventListener('load', resolve); });
  await wait(window, 400);

  const doc = window.document;
  const editor = doc.getElementById('editor');
  const preview = doc.getElementById('preview');
  const toast = doc.getElementById('toast');

  report('页面脚本已就绪', !!(window.Md2GZHImport && editor && window.Md2GZHThemes),
    'importer=' + typeof window.Md2GZHImport);

  /* 文章包：demo/article.md 引用 img/cover.png，图片放在 demo/img/ 下 */
  const markdown = [
    '# 导入测试 / 文章包',
    '',
    '正文第一段，应该原样保留。',
    '',
    '![封面](img/cover.png)',
    '',
    '外链图片不动：![外链](https://example.com/x.png)',
    ''
  ].join('\n');
  const mdFile = makeFile(window, markdown, 'article.md', 'text/markdown', 'demo/article.md');
  const pngFile = makeFile(window, Buffer.from(PNG_1PX, 'base64'), 'cover.png', 'image/png', 'demo/img/cover.png');
  const readmeFile = makeFile(window, '# 说明\n', 'README.md', 'text/markdown', 'demo/README.md');

  const input = doc.getElementById('importPackageInput');
  report('工具栏有导入按钮和隐藏 input',
    !!(doc.getElementById('btnImportPackage') && doc.getElementById('btnImportFile') && input && doc.getElementById('importFileInput')));

  Object.defineProperty(input, 'files', { value: [mdFile, pngFile, readmeFile], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await wait(window, 900);

  const text = editor.value;
  report('正文换成了导入的文稿', text.indexOf('正文第一段，应该原样保留。') !== -1);
  report('跳过 README 选中了 article.md', text.indexOf('导入测试') !== -1 && text.indexOf('说明') === -1);
  report('本地图片被内联成 data URL', text.indexOf('![封面](data:image/png;base64,') !== -1);
  report('外链图片保持原样', text.indexOf('![外链](https://example.com/x.png)') !== -1);
  report('预览里也拿到了内联图片', (preview.srcdoc || '').indexOf('data:image/png;base64,') !== -1);
  report('提示条报告了导入结果', /已导入 article.md/.test(toast.textContent || ''), JSON.stringify(toast.textContent));

  /* 单篇导入：不应该动图片引用 */
  const single = doc.getElementById('importFileInput');
  const soloFile = makeFile(window, '# 单篇\n\n没有图片。\n', 'solo.md', 'text/markdown', 'solo.md');
  Object.defineProperty(single, 'files', { value: [soloFile], configurable: true });
  single.dispatchEvent(new window.Event('change'));
  await wait(window, 700);
  report('单篇导入替换正文', editor.value.indexOf('没有图片') !== -1);
  report('单篇导入也给了提示', /已导入 solo.md/.test(toast.textContent || ''));

  window.close();
  console.log(fail ? '\n有失败项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
}

main().catch(function (error) {
  console.error('端到端测试崩了:', error);
  process.exit(1);
});
