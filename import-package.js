/* 文章包导入：从文件夹里挑出文稿，把同目录的本地图片读成内联 data URL，
 * 再重写 Markdown 里的图片引用。纯逻辑部分不碰 DOM，node 里可直接测。
 * 支持写法：![alt](img/a.png "标题")、![alt](<img/a.png>)、![[img/a.png]]、<img src="...">
 */
(function (global, factory) {
  var api = factory();
  global.Md2GZHImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TEXT_EXT = { md: 1, markdown: 1, mdown: 1, txt: 1 };
  var IMAGE_EXT = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1, avif: 1 };

  /* 超过这个体积的位图先等比缩一道再内联，免得正文变成几 MB 的 base64 */
  var RAW_LIMIT = 1400000;
  var MAX_EDGE = 1600;

  function fileExt(name) {
    var matched = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return matched ? matched[1] : '';
  }
  function isTextFile(file) { return !!TEXT_EXT[fileExt(file && file.name)]; }
  function isImageFile(file) { return !!IMAGE_EXT[fileExt(file && file.name)]; }

  function readFile(file, asText) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('文件读取失败')); };
      if (asText) reader.readAsText(file); else reader.readAsDataURL(file);
    });
  }

  /* 相对路径拆成逐级后缀，Markdown 里写成 img/a.png 还是 a.png 都能对上 */
  function pathKeys(raw) {
    var value = String(raw == null ? '' : raw).trim().replace(/^<|>$/g, '');
    try { value = decodeURIComponent(value); } catch (error) {}
    value = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!value) return [];
    var parts = value.split('/');
    var keys = [];
    for (var i = 0; i < parts.length; i++) {
      var key = parts.slice(i).join('/').toLowerCase();
      if (keys.indexOf(key) === -1) keys.push(key);
    }
    return keys;
  }

  function downscaleDataUrl(dataUrl, format) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var width = image.naturalWidth;
        var height = image.naturalHeight;
        var scale = Math.min(1, MAX_EDGE / Math.max(width, height));
        if (scale >= 1) { resolve(dataUrl); return; }
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var context = canvas.getContext('2d');
        if (format === 'jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/' + format, 0.88));
      };
      image.onerror = function () { reject(new Error('图片解码失败')); };
      image.src = dataUrl;
    });
  }

  function prepareImage(file) {
    var ext = fileExt(file.name);
    return readFile(file, false).then(function (dataUrl) {
      if (ext === 'svg' || ext === 'gif' || file.size <= RAW_LIMIT) return dataUrl;
      var format = (ext === 'png' || ext === 'webp') ? ext : 'jpeg';
      return downscaleDataUrl(dataUrl, format).catch(function () { return dataUrl; });
    });
  }

  /* 图片按「完整相对路径 + 逐级后缀」双份建索引，正文里怎么写都能命中 */
  function buildImageMap(files) {
    var images = (files || []).filter(isImageFile);
    return Promise.all(images.map(function (file) {
      return prepareImage(file).then(function (dataUrl) {
        return { file: file, dataUrl: dataUrl };
      }).catch(function () { return null; });
    })).then(function (items) {
      var map = {};
      var used = [];
      items.forEach(function (item) {
        if (!item) return;
        used.push(item.file);
        pathKeys(item.file.webkitRelativePath || item.file.name).forEach(function (key) {
          if (!map[key]) map[key] = item.dataUrl;
        });
      });
      return { map: map, used: used, images: images.length };
    });
  }

  function resolveImageRef(reference, map) {
    if (/^(?:https?:|data:|blob:|mailto:|#)/i.test(reference)) return reference;
    var keys = pathKeys(reference);
    for (var i = 0; i < keys.length; i++) if (map[keys[i]]) return map[keys[i]];
    return '';
  }

  function rewriteImageRefs(md, map) {
    var missing = [];
    var index = map || {};
    function swap(reference) {
      var hit = resolveImageRef(reference, index);
      if (!hit) { missing.push(reference); return reference; }
      return hit;
    }
    var text = String(md == null ? '' : md)
      .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, function (all, target) {
        return '![](' + swap(target) + ')';
      })
      .replace(/!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)((?:\s+["'][^"']*["'])?)\s*\)/g, function (all, alt, reference, title) {
        return '![' + alt + '](' + swap(reference.replace(/^<|>$/g, '')) + title + ')';
      })
      .replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, function (all, head, reference, quote) {
        return head + swap(reference) + quote;
      });
    return { text: text, missing: missing };
  }

  /* 文件夹里可能躺着好几篇文稿：先排掉 README，再取最大的一篇 */
  function pickDocument(files) {
    var docs = (files || []).filter(isTextFile);
    if (!docs.length) return null;
    var preferred = docs.filter(function (file) { return !/^readme\b/i.test(file.name); });
    return (preferred.length ? preferred : docs).slice().sort(function (a, b) { return b.size - a.size; })[0];
  }

  function describe(files, doc, result, used) {
    var summary = ['已导入 ' + doc.name];
    if (used && used.length) summary.push(used.length + ' 张图片已内联');
    if (result && result.missing.length) summary.push(result.missing.length + ' 处图片没匹配上');
    return '✓ ' + summary.join('，');
  }

  return {
    TEXT_EXT: TEXT_EXT,
    IMAGE_EXT: IMAGE_EXT,
    fileExt: fileExt,
    isTextFile: isTextFile,
    isImageFile: isImageFile,
    readFile: readFile,
    pathKeys: pathKeys,
    prepareImage: prepareImage,
    buildImageMap: buildImageMap,
    rewriteImageRefs: rewriteImageRefs,
    pickDocument: pickDocument,
    describe: describe
  };
});