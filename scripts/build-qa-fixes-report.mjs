#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDirectory = 'artifacts/full-qa-2026-09-19';
const reportDirectory = 'artifacts/qa-fixes-2026-09-20';
const labels = {
  fixed: '已修复', mitigated: '风险已降低', unavailable: '暂不可用',
  passed: '通过', failed: '未通过', pending: '待验证', not_run: '未运行',
  indirect_passed: '间接验证', not_applicable: '不适用', blocked: '受阻',
  partial: '部分验证', planned: '计划中', unknown: '未说明',
  frontend: '前端测试', backend: '后端测试', build: '生产构建', lint: '代码检查',
  automated: '自动化验证', browser: '浏览器验证', artifact: '导出／文件验证',
  status: '状态', summary: '说明', tests: '测试', suites: '测试文件', files: '文件',
  passedTests: '通过项数', totalTests: '总项数', errors: '错误', warnings: '警告',
  duration: '耗时', count: '数量', evidence: '证据', limitations: '限制', notes: '备注'
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const escapeMarkdown = value => String(value ?? '').replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/\r?\n/g, ' ');
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
const label = value => labels[value] || String(value ?? '未说明');
const statusClass = value => ['passed', 'fixed'].includes(value) ? 'good' : ['failed', 'unavailable', 'blocked'].includes(value) ? 'bad' : ['mitigated', 'pending', 'partial', 'indirect_passed', 'not_run'].includes(value) ? 'waiting' : 'neutral';
const badge = (status, prefix = '') => `<span class="badge ${statusClass(status)}">${escapeHtml(prefix)}${escapeHtml(label(status || 'unknown'))}</span>`;
const paragraph = value => value ? `<p>${escapeHtml(value)}</p>` : '';
const list = (values, ordered = false) => array(values).length ? `<${ordered ? 'ol' : 'ul'}>${array(values).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '';
const relativeUrl = value => value.split('/').map(segment => encodeURIComponent(segment)).join('/');

function safeRelativePath(value) {
  if (typeof value !== 'string' || /[\\\0?#]/.test(value) || /^(?:[a-z]+:|\/)/i.test(value)) return null;
  const segments = value.split('/');
  return segments.every(segment => segment && segment !== '..' && segment !== '.') ? value : null;
}

function existingFile(filename) {
  try { return statSync(filename).isFile(); } catch { return false; }
}

function evidenceItems(values, original, root) {
  const directory = original ? auditDirectory : reportDirectory;
  const name = path.posix.basename(directory);
  return array(values).map(value => {
    const raw = typeof value === 'string' ? value : value?.path || value?.file || '';
    let candidate = raw;
    for (const prefix of [`${directory}/`, `../${name}/`, `${name}/`]) {
      if (candidate.startsWith(prefix)) { candidate = candidate.slice(prefix.length); break; }
    }
    const safe = safeRelativePath(candidate);
    const exists = safe && existingFile(path.join(root, directory, safe));
    return {
      text: typeof value === 'object' ? value?.label || value?.title || raw : raw,
      url: safe ? `${original ? `../${name}/` : ''}${relativeUrl(safe)}` : null,
      exists: Boolean(exists), image: Boolean(exists && /\.(?:png|jpe?g|webp|gif)$/i.test(safe)),
      reason: safe ? '证据文件未找到' : '无效的本地证据路径'
    };
  });
}

function evidenceHtml(values, original, root) {
  const items = evidenceItems(values, original, root);
  if (!items.length) return '<p class="muted small">未提供独立证据文件。</p>';
  const links = items.map(item => `<li>${item.exists ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.text)}</a>` : `<span>${escapeHtml(item.text)} <span class="missing">（${item.reason}）</span></span>`}</li>`).join('');
  const images = items.filter(item => item.image).map(item => `<figure><a href="${escapeHtml(item.url)}"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(`${original ? '原始复现' : '本轮验证'}截图：${item.text}`)}" loading="lazy" decoding="async"></a><figcaption>${escapeHtml(item.text)}</figcaption></figure>`).join('');
  return `<ul class="evidence-links">${links}</ul>${images ? `<div class="screenshots">${images}</div>` : ''}`;
}

function evidenceMarkdown(values, original, root) {
  return evidenceItems(values, original, root).map(item => item.exists
    ? `- [${escapeMarkdown(item.text)}](${item.url})${item.image && !original ? `\n\n  ![本轮验证截图：${escapeMarkdown(item.text)}](${item.url})` : ''}`
    : `- ${escapeMarkdown(item.text)}（${item.reason}）`).join('\n');
}

function fileLinks(values, root) {
  return array(values).map(value => {
    const safe = safeRelativePath(value);
    return safe && existingFile(path.join(root, safe))
      ? `<li><a href="../../${escapeHtml(relativeUrl(safe))}"><code>${escapeHtml(value)}</code></a></li>`
      : `<li><code>${escapeHtml(value)}</code></li>`;
  }).join('');
}

function objectHtml(value) {
  if (value == null) return '<span class="muted">未提供</span>';
  if (Array.isArray(value)) return `<ul>${value.map(item => `<li>${objectHtml(item)}</li>`).join('')}</ul>`;
  if (typeof value === 'object') return `<dl class="facts">${Object.entries(value).map(([key, item]) => `<dt>${escapeHtml(label(key))}</dt><dd>${key === 'status' ? badge(item) : objectHtml(item)}</dd>`).join('')}</dl>`;
  return escapeHtml(value);
}

function verificationHtml(verification = {}, root) {
  return Object.entries(verification).map(([kind, result]) => {
    const detail = typeof result === 'object' && result ? result : { status: result };
    const extra = Object.fromEntries(Object.entries(detail).filter(([key]) => !['status', 'summary', 'tests', 'evidence'].includes(key)));
    return `<section class="verification"><h4>${escapeHtml(label(kind))} ${badge(detail.status)}</h4>${paragraph(detail.summary)}${detail.tests?.length ? `<details><summary>相关测试文件</summary><ul class="files">${fileLinks(detail.tests, root)}</ul></details>` : ''}${detail.evidence?.length ? evidenceHtml(detail.evidence, false, root) : ''}${Object.keys(extra).length ? objectHtml(extra) : ''}</section>`;
  }).join('');
}

function verificationMarkdown(verification = {}, root) {
  return Object.entries(verification).map(([kind, result]) => {
    const detail = typeof result === 'object' && result ? result : { status: result };
    const extra = Object.fromEntries(Object.entries(detail).filter(([key]) => !['status', 'summary', 'tests', 'evidence'].includes(key)));
    return `**${label(kind)}：${label(detail.status || 'unknown')}**\n\n${detail.summary || ''}${detail.tests?.length ? `\n\n相关测试：\n\n${detail.tests.map(test => `- ${escapeMarkdown(test)}`).join('\n')}` : ''}${detail.evidence?.length ? `\n\n${evidenceMarkdown(detail.evidence, false, root)}` : ''}${Object.keys(extra).length ? `\n\n\`\`\`json\n${JSON.stringify(extra, null, 2)}\n\`\`\`` : ''}`;
  }).join('\n\n');
}

function bugHtml(item, root) {
  const checks = Object.entries(item.verification || {}).map(([kind, value]) => badge(value?.status || value, `${label(kind)}：`)).join('');
  return `<article class="bug" id="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">
    <div class="bug-heading"><div><span class="identifier">${escapeHtml(item.id)} · ${escapeHtml(item.severity)}</span><h2>${escapeHtml(item.title)}</h2></div>${badge(item.status)}</div>
    <p class="area"><strong>问题位置</strong> ${escapeHtml(item.area)}</p>
    <div class="resolution"><strong>本轮处理</strong>${paragraph(item.resolution)}</div><div class="badges">${checks}</div>
    <details><summary>触发步骤、旧结果与预期</summary><h3>如何触发</h3>${list(item.originalReproductionSteps, true)}<h3>原始结果</h3>${paragraph(item.originalActual)}<h3>预期结果</h3>${paragraph(item.expected)}<h3>原始复现证据</h3>${evidenceHtml(item.originalEvidence, true, root)}</details>
    <details><summary>本轮验证与真实证据</summary>${verificationHtml(item.verification, root)}</details>
    <details><summary>修改位置（${array(item.changedFiles).length} 个文件）</summary><ul class="files">${fileLinks(item.changedFiles, root)}</ul></details>
    ${item.limitations?.length ? `<div class="limitations"><h3>仍需注意</h3>${list(item.limitations)}</div>` : ''}
  </article>`;
}

const css = `
:root{color-scheme:light;--ink:#172b3a;--muted:#526574;--line:#dce4e7;--paper:#fff;--bg:#f3f6f6;--green:#14634f;--amber:#815400;--red:#a1393b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}a{color:#126178;text-underline-offset:3px}a:hover{color:#093c4b}header,main,footer{max-width:1180px;margin:auto;padding:28px}header{padding-top:44px}h1{font-size:clamp(28px,5vw,44px);line-height:1.2;letter-spacing:-1px;margin:10px 0 18px}h2{font-size:22px;line-height:1.4;margin:8px 0}h3{font-size:17px;margin:20px 0 8px}h4{font-size:16px;margin:0 0 10px}p{margin:8px 0 14px}ul,ol{padding-left:24px}li+li{margin-top:6px}.eyebrow,.identifier{font-size:13px;letter-spacing:1px;font-weight:700;color:var(--muted)}.muted,.small{color:var(--muted)}.small{font-size:13px}.notice{padding:14px 18px;border-left:4px solid #b58a32;background:#fff7e4;border-radius:0 8px 8px 0}.counts{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0}.count{background:var(--paper);border:1px solid var(--line);padding:18px 22px;border-radius:12px}.count b{display:block;font-size:34px;line-height:1.2}.count span{font-size:14px;color:var(--muted)}.badge{display:inline-block;border-radius:100px;padding:3px 10px;font-size:12px;line-height:1.6;font-weight:650;white-space:nowrap}.good{color:var(--green);background:#e2f4eb}.bad{color:var(--red);background:#fbe8e7}.waiting{color:var(--amber);background:#fff0ce}.neutral{color:#4d5965;background:#eaf0f4}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.toolbar{position:sticky;top:0;z-index:2;background:rgba(243,246,246,.98);border-bottom:1px solid var(--line);padding:14px 0;margin-bottom:24px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.toolbar label{font-size:13px;font-weight:650}.toolbar input,.toolbar select{display:block;border:1px solid #becdd2;border-radius:8px;background:white;color:var(--ink);font:inherit;padding:10px 12px;min-height:46px}.search{flex:1;min-width:210px}.search input{width:100%}.toolbar select{min-width:160px}.toolbar output{font-size:13px;color:var(--muted);align-self:end;padding:12px 0}.bug,.panel,.roadmap-item{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 2px 5px #203b4a04}.bug-heading{display:flex;justify-content:space-between;gap:20px;align-items:start}.bug-heading>.badge{margin-top:6px}.area{color:var(--muted);font-size:14px}.area strong{color:var(--ink);margin-right:10px}.resolution{padding:14px 18px;background:#eff6f6;border-radius:8px;margin:16px 0}.resolution p{margin-bottom:0}details{border-top:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:650}details[open]>summary{margin-bottom:16px}.files{font-size:13px;overflow-wrap:anywhere}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.verification+.verification{border-top:1px dashed var(--line);padding-top:20px;margin-top:20px}.limitations{border-left:3px solid #dba447;padding:2px 0 2px 16px;margin-top:16px}.limitations h3{margin-top:4px}.limitations ul{margin-bottom:8px}.evidence-links{font-size:14px;overflow-wrap:anywhere}.screenshots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}figure{margin:8px 0;background:#f5f7f8;border:1px solid var(--line);border-radius:8px;overflow:hidden}figure img{display:block;width:100%;height:auto}figcaption{font-size:12px;overflow-wrap:anywhere;padding:8px 12px;color:var(--muted)}.missing{color:var(--amber);font-size:12px}.validation-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.validation-item{border:1px solid var(--line);border-radius:9px;padding:16px}.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:14px;margin:8px 0}.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}.facts .facts{display:block}.facts .facts dt{font-weight:650}.facts ul{margin:0}.section-title{margin:38px 0 18px;font-size:26px}.definition{font-size:14px}.definition .badge{margin-right:8px}.roadmap-item .identifier{letter-spacing:.4px}.empty{text-align:center;padding:42px;border:1px dashed #b7c5cb;border-radius:12px}.top-links{display:flex;gap:16px;flex-wrap:wrap;font-size:14px}[hidden]{display:none!important}footer{font-size:13px;color:var(--muted);padding-bottom:44px}@media(max-width:650px){header,main,footer{padding:20px}.counts{grid-template-columns:repeat(2,1fr)}.bug,.panel,.roadmap-item{padding:18px}.bug-heading{display:block}.toolbar{position:static}.facts{grid-template-columns:1fr}.facts dt{font-weight:650}.facts dd{margin-bottom:8px}}@media print{.toolbar,.top-links{display:none}body{background:white}.bug,.panel,.roadmap-item{box-shadow:none;break-inside:avoid}header,main,footer{max-width:none;padding:12px}.screenshots{display:block}img{max-width:100%}}
`;

const browserScript = `
const search = document.getElementById('search');
const filter = document.getElementById('status-filter');
const cards = [...document.querySelectorAll('.bug')];
const records = cards.map(card => ({card, text:card.textContent.toLocaleLowerCase()}));
function update() {
  const terms = search.value.trim().toLocaleLowerCase().split(/\\s+/).filter(Boolean);
  let count = 0;
  for (const {card,text} of records) {
    const visible = (!filter.value || card.dataset.status === filter.value) && terms.every(term => text.includes(term));
    card.hidden = !visible;
    if (visible) count++;
  }
  document.getElementById('result-count').textContent = '显示 ' + count + ' / ' + cards.length + ' 项';
  document.getElementById('empty').hidden = count > 0;
}
search.addEventListener('input', update);
filter.addEventListener('change', update);
document.getElementById('expand-all').addEventListener('click', () => { for (const {card} of records) if (!card.hidden) for (const details of card.querySelectorAll('details')) details.open = true; });
document.getElementById('collapse-all').addEventListener('click', () => { for (const details of document.querySelectorAll('.bug details')) details.open = false; });
const linkedCard = document.getElementById(decodeURIComponent(location.hash.slice(1)));
if (linkedCard?.classList.contains('bug')) for (const details of linkedCard.querySelectorAll('details')) details.open = true;
update();
`;

export function renderReport(data, { root = repositoryRoot } = {}) {
  if (!Array.isArray(data.resolutions)) throw new Error('resolutions must be an array.');
  const counts = { fixed: 0, mitigated: 0, unavailable: 0 };
  const ids = new Set();
  for (const item of data.resolutions) {
    if (!Object.hasOwn(counts, item.status)) throw new Error(`Unknown resolution status: ${item.status}`);
    if (!/^QA-\d+$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate resolution ID: ${item.id}`);
    ids.add(item.id); counts[item.status]++;
  }
  const definitions = Object.entries(data.statusDefinitions || {}).map(([status, description]) => `<p class="definition">${badge(status)} ${escapeHtml(description)}</p>`).join('');
  const validation = data.validation && Object.keys(data.validation).length ? `<section class="panel" aria-labelledby="validation-title"><h2 id="validation-title">本轮整体验证</h2><div class="validation-grid">${Object.entries(data.validation).map(([key, value]) => `<div class="validation-item"><h3>${escapeHtml(label(key))}</h3>${objectHtml(value)}</div>`).join('')}</div></section>` : '';
  const improvements = array(data.additionalImplementedImprovements);
  const roadmap = array(data.roadmap);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CREATE 修复与验证报告 · ${escapeHtml(data.date || '')}</title><style>${css}</style></head><body>
<header><div class="eyebrow">TLEF CREATE · QA &amp; PRODUCT REVIEW</div><h1>修复进展与验证记录</h1><p class="muted">${escapeHtml(data.date || '')} · ${escapeHtml(data.environment || '')}</p><p>从原始复现到本轮处理，逐项列出问题位置、验证范围与仍存在的限制。</p><div class="counts"><div class="count"><b>${data.resolutions.length}</b><span>问题记录</span></div>${Object.entries(counts).map(([status, count]) => `<div class="count"><b>${count}</b><span>${label(status)}</span></div>`).join('')}</div><p class="notice">${escapeHtml(data.verificationSnapshot || '待验证不等于通过；代码已修复也不代表所有浏览器或外部部署均已验收。')}</p><div class="top-links"><a href="report.md">下载 Markdown 报告</a><a href="resolutions.json">查看结构化记录</a><a href="../full-qa-2026-09-19/index.html">原始 QA 报告</a><a href="../h5p-studio-audit/index.html">各 H5P 类型截图</a><a href="#roadmap">后续提升计划</a></div></header>
<main>${validation}<details class="panel"><summary>如何理解修复状态</summary>${definitions}</details><section aria-labelledby="bugs-title"><h2 id="bugs-title" class="section-title">逐项问题与修复</h2><div class="toolbar"><label class="search">搜索问题、位置或验证内容<input id="search" type="search" placeholder="例如：材料、Documentation、QA-21" autocomplete="off"></label><label>处理状态<select id="status-filter"><option value="">全部状态</option><option value="fixed">已修复</option><option value="mitigated">风险已降低</option><option value="unavailable">暂不可用</option></select></label><output id="result-count" aria-live="polite"></output></div><div class="top-links"><button id="expand-all" type="button">展开可见问题详情</button><button id="collapse-all" type="button">收起全部详情</button></div><p class="small">每项的自动化、浏览器与导出验证分别记录；点开详情查看证据。</p>${data.resolutions.map(item => bugHtml(item, root)).join('\n')}<p id="empty" class="empty" hidden>没有符合当前条件的问题。</p></section>
${improvements.length ? `<section aria-labelledby="improvements-title"><h2 class="section-title" id="improvements-title">本轮补充提升</h2>${improvements.map(item => `<article class="panel"><h3>${escapeHtml(item.title)}</h3>${paragraph(item.summary)}<details><summary>实现与验证位置</summary><ul class="files">${fileLinks([...array(item.changedFiles), ...array(item.verificationTests)], root)}</ul></details></article>`).join('')}</section>` : ''}
${data.limitations?.length ? `<section class="panel"><h2>本轮边界</h2>${list(data.limitations)}</section>` : ''}
<section id="roadmap" aria-labelledby="roadmap-title"><h2 class="section-title" id="roadmap-title">后续提升计划</h2><p class="muted">以下为计划建议，尚未作为本轮已完成修复计数。</p>${roadmap.map(item => `<article class="roadmap-item"><div class="identifier">${escapeHtml(item.id)} · ${escapeHtml(item.priority)} · ${escapeHtml(label(item.status || 'planned'))}</div><h3>${escapeHtml(item.title)}</h3><p><strong>现状：</strong>${escapeHtml(item.problem)}</p><p><strong>建议：</strong>${escapeHtml(item.boundedProposal)}</p><p><strong>验收标准：</strong>${escapeHtml(item.acceptance)}</p>${item.observedCode?.length ? `<details><summary>依据的代码位置</summary><ul class="files">${fileLinks(item.observedCode, root)}</ul></details>` : ''}</article>`).join('')}</section></main><footer>数据来源：本目录 resolutions.json。截图仅使用记录中存在的本地证据；缺失文件会明确标注。页面不请求外部服务。</footer><script>${browserScript}</script></body></html>`;

  const markdown = `# CREATE 修复进展与验证记录\n\n${data.date || ''} · ${data.environment || ''}\n\n共 ${data.resolutions.length} 项：${counts.fixed} 已修复 / ${counts.mitigated} 风险已降低 / ${counts.unavailable} 暂不可用。\n\n${data.verificationSnapshot || '待验证不等于通过；各项验证范围单独列明。'}\n\n[交互报告](index.html) · [结构化记录](resolutions.json) · [原始 QA 报告](../full-qa-2026-09-19/index.html)\n\n${data.validation ? `## 本轮整体验证\n\n\`\`\`json\n${JSON.stringify(data.validation, null, 2)}\n\`\`\`\n\n` : ''}## 状态说明\n\n${Object.entries(data.statusDefinitions || {}).map(([status, description]) => `- **${label(status)}：**${description}`).join('\n')}\n\n${data.resolutions.map(item => `## ${item.id} · ${item.title}\n\n**${item.severity} · ${label(item.status)}**\n\n**问题位置：**${item.area}\n\n### 如何触发\n\n${array(item.originalReproductionSteps).map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n**原始结果：**${item.originalActual}\n\n**预期结果：**${item.expected}\n\n**本轮处理：**${item.resolution}\n\n### 原始复现证据\n\n${evidenceMarkdown(item.originalEvidence, true, root) || '未提供独立证据文件。'}\n\n### 本轮验证\n\n${verificationMarkdown(item.verification, root)}\n\n### 修改位置\n\n${array(item.changedFiles).map(file => `- ${escapeMarkdown(file)}`).join('\n')}${item.limitations?.length ? `\n\n### 仍需注意\n\n${item.limitations.map(value => `- ${value}`).join('\n')}` : ''}`).join('\n\n')}\n\n## 本轮补充提升\n\n${improvements.map(item => `### ${item.title}\n\n${item.summary}\n\n实现与验证文件：\n\n${[...array(item.changedFiles), ...array(item.verificationTests)].map(file => `- ${escapeMarkdown(file)}`).join('\n')}`).join('\n\n')}\n\n## 本轮边界\n\n${array(data.limitations).map(value => `- ${value}`).join('\n')}\n\n## 后续提升计划\n\n以下为计划建议，尚未作为本轮已完成修复计数。\n\n${roadmap.map(item => `### ${item.id} · ${item.title}\n\n${item.priority} · ${label(item.status || 'planned')}\n\n**现状：**${item.problem}\n\n**建议：**${item.boundedProposal}\n\n**验收标准：**${item.acceptance}\n\n依据：\n\n${array(item.observedCode).map(file => `- ${escapeMarkdown(file)}`).join('\n')}`).join('\n\n')}\n`;
  return { html, markdown, counts };
}

function main() {
  const args = process.argv.slice(2);
  let input = path.join(repositoryRoot, reportDirectory, 'resolutions.json');
  let output = path.join(repositoryRoot, reportDirectory);
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index + 1]) throw new Error('Expected --input FILE or --output-dir DIRECTORY.');
    if (args[index] === '--input') input = path.resolve(args[index + 1]);
    else if (args[index] === '--output-dir') output = path.resolve(args[index + 1]);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  const data = JSON.parse(readFileSync(input, 'utf8'));
  const { html, markdown, counts } = renderReport(data);
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'index.html'), html);
  writeFileSync(path.join(output, 'report.md'), markdown);
  console.log(`Generated ${path.join(output, 'index.html')} and report.md (${JSON.stringify(counts)}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
