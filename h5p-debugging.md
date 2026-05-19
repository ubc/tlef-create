# H5P Debugging Notes

记录 H5P 相关问题的排查过程和解决方法。

---

## [2026-05-18] Crossword — Library not available for preview

### 现象
预览 Crossword 类型题目时，页面显示：
```
H5P.Crossword — Library not available for preview.
```

### 根本原因
`H5P.classFromName('Crossword')` 返回 `undefined`，说明 Crossword 的 JS 没有注册到 `window.H5P` 命名空间。

追踪链：
1. `h5p-core.js` 调用 `H5P.classFromName(machineName)`
2. 该函数沿 `window.H5P.Crossword` 路径查找构造函数
3. 找不到 → 渲染 placeholder 错误信息

### 原因定位
`h5p-libs/H5P.Crossword-0.4/` 目录里**缺少 `dist/` 文件夹**，而 `library.json` 里声明的主 JS 是 `dist/h5p-crossword.js`。文件不存在，JS 从未加载，类也从未注册。

```
H5P.Crossword-0.4/
├── icon.svg
├── language/
├── library.json
├── semantics.json
└── upgrades.js     ← 没有 dist/，库无法运行
```

### 解决方法
用带有完整 `dist/` 的 **0.5 版本**替换。需要同时改三个地方：

**1. 复制完整库文件**
```bash
cp -r /path/to/H5P.Crossword-0.5 tlef-create/routes/create/h5p-libs/
```

**2. `h5pExportService.js`**
```js
// 改前
"library": "H5P.Crossword 0.4"
// 改后
"library": "H5P.Crossword 0.5"
```

**3. `h5pLibraryRegistry.js`**
```js
// 改前
'H5P.Crossword': { majorVersion: 0, minorVersion: 4, dirName: 'H5P.Crossword-0.4' }
// 改后
'H5P.Crossword': { majorVersion: 0, minorVersion: 5, dirName: 'H5P.Crossword-0.5' }
```

### 排查套路（适用于所有 H5P "Library not available" 错误）

1. **确认 `h5p-libs/` 里对应库目录存在**
2. **确认目录里有 `dist/` 文件夹**（`library.json` 的 `preloadedJs` 里声明了哪个文件，那个文件就必须存在）
3. **确认 `h5pLibraryRegistry.js` 里的版本号和 `dirName` 与实际目录名一致**
4. **确认 `h5pExportService.js` 里的 library 字符串版本号也一致**

版本号只要有一处对不上，库就加载不到。
