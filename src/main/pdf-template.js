// Print layout based on landing/src/styles/global.css: paper, mint and notebook rules.
// Embed local fonts so exports also work offline and in the packaged app.
const fs = require('fs');
const path = require('path');
const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let fonts;
let appLogo;
function logo() {
  if (!appLogo) appLogo = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '../../assets/app-icon.svg')).toString('base64')}`;
  return `<img class="app-logo" src="${appLogo}" alt="Ivueno" width="30" height="30">`;
}
function fontStyles() {
  if (!fonts) fonts = [['Notes', 'body', 400], ['Notes', 'bold', 700], ['Notes Mono', 'mono', 400]]
    .map(([family, file, weight]) => `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, '../../assets/pdf', `${file}.woff2`)).toString('base64')}) format('woff2')}`).join('');
  return fonts;
}

function renderMeetingPdf(s, { brand = false } = {}) {
  let number = 0;
  const heading = (label) => `<h2><span class="section-number">${String(++number).padStart(2, '0')}</span>${label}</h2>`;
  const section = (label, content, cls = '') => `<section class="${cls}">${heading(label)}${content}</section>`;
  const timestamp = (t) => t ? `<span class="timestamp">${esc(t)}</span>` : '';
  const hasNotes = s.summary || s.mine.length || s.blocks.some(b => b.add) || s.extra.length || s.tasks.length;
  return `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><title>${esc(s.title)}</title>
<style>${fontStyles()}
@page{size:auto;margin:17mm 18mm 19mm;@bottom-left{content:'NOTAS DE REUNIÃO';font-family:'Notes Mono',monospace;font-size:7pt;color:#6B655C}@bottom-right{content:counter(page);font-family:'Notes Mono',monospace;font-size:8pt;color:#087B70}}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#FFFEFC}
body{margin:0;color:#1F1D1A;font:10.5pt/1.5 'Notes','Segoe UI',Arial,sans-serif;overflow-wrap:anywhere}
.document-header{border-top:4px solid #087B70;padding-top:16px;margin-bottom:22px}
.eyebrow{display:flex;align-items:center;gap:9px;font:8pt 'Notes Mono',monospace;letter-spacing:.12em;color:#087B70;text-transform:uppercase;margin:0 0 18px}
.app-logo{display:block;width:30px;height:30px;flex:none;object-fit:contain}.brand-footer .app-logo{width:22px;height:22px}
h1{color:#0A2427;font-size:30pt;line-height:1.08;letter-spacing:-.035em;margin:0 0 18px;font-weight:700;overflow-wrap:anywhere}
.meeting-meta{font-size:9pt;color:#57524B;border-top:1px solid #E2DDD5;padding-top:12px}
.people{margin-top:8px;line-height:1.6}.meta-label{color:#087B70;font-size:8pt;font-weight:700;margin-right:9px}
section{margin:19px 0 0}
h2{display:flex;align-items:baseline;gap:10px;font-size:13pt;line-height:1.25;color:#0A2427;margin:0 0 10px;border-bottom:1px solid #E2DDD5;padding-bottom:8px;break-after:avoid}
.section-number{font:8pt 'Notes Mono',monospace;color:#087B70}
p{margin:0 0 9px;orphans:3;widows:3}.text{white-space:pre-wrap}
.summary{background:#DDF6EC;border:1px solid #9FDCC7;border-left:4px solid #087B70;border-radius:3px 12px 4px 4px;padding:17px 19px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.summary h2{border-bottom-color:#9FDCC7}.summary p:last-child{margin-bottom:0}
.personal-note{padding:5px 0 7px 13px;border-left:2px solid #9FDCC7;border-bottom:1px solid #EFECE7;white-space:pre-wrap}
.note-block{margin-bottom:13px;break-inside:avoid}.note-block p{margin-bottom:4px}.addition{border-left:2px solid #9FDCC7;padding-left:13px;color:#57524B;margin:5px 0 0 2px}
.timestamp{font:8pt 'Notes Mono',monospace;color:#087B70;white-space:nowrap;margin-left:8px}
.extra-list{margin:0;padding-left:18px}.extra-list li{padding:0 0 7px 4px;white-space:pre-wrap}.extra-list li::marker{color:#087B70}
.task-list{list-style:none;padding:0;margin:0}.task{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid #E2DDD5;padding:8px 0;break-inside:avoid}
.check{width:13px;height:13px;flex:none;border:1.2px solid #087B70;border-radius:3px;position:relative;top:2px}.done .check{background:#B7F5D8}.done .check::after{content:'';display:block;width:7px;height:4px;border-left:1.5px solid #074944;border-bottom:1.5px solid #074944;transform:translate(2px,2px) rotate(-45deg)}
.task-content{min-width:0;flex:1}.task-text{white-space:pre-wrap}.task-meta{font-size:8.5pt;color:#57524B;margin-top:3px;white-space:pre-wrap}
.transcript.new-page{break-before:page;margin-top:0}.utterance{break-inside:avoid;padding:0 0 12px 13px;border-left:2px solid #9FDCC7;margin-bottom:9px}.speaker{font-size:9pt;color:#0A2427;break-after:avoid;margin-bottom:4px}.utterance p:last-child{margin-bottom:0}.translation{color:#57524B;font-style:italic}
.brand-footer{display:flex;align-items:center;gap:8px;border-top:1px solid #E2DDD5;padding-top:12px;margin-top:28px;color:#087B70;font-size:8.5pt;break-inside:avoid}
@media screen{html{background:#EFECE7}body{max-width:210mm;margin:24px auto;padding:17mm 18mm 19mm;background:#FFFEFC;box-shadow:0 8px 36px #0A242718}}
</style></head><body>
<header class="document-header"><div class="eyebrow">${logo()}Notas de reunião</div><h1>${esc(s.title)}</h1>
${s.when || s.people.length ? `<div class="meeting-meta">${s.when ? `<div>${esc(s.when)}</div>` : ''}${s.people.length ? `<div class="people"><span class="meta-label">PARTICIPANTES</span>${s.people.map(esc).join(' · ')}</div>` : ''}</div>` : ''}</header>
<main>
${s.summary ? section('Resumo', `<p class="text">${esc(s.summary)}</p>`, 'summary') : ''}
${s.mine.length ? section('As tuas notas', s.mine.map(l => `<div class="personal-note">${esc(l)}</div>`).join('')) : ''}
${s.blocks.some(b => b.add) ? section('Notas da Ivueno', s.blocks.map(b => `<div class="note-block"><p class="text">${esc(b.mine)}</p>${b.add ? `<div class="addition text">${esc(b.add)}${timestamp(b.t)}</div>` : ''}</div>`).join('')) : ''}
${s.extra.length ? section('Também foi dito', `<ul class="extra-list">${s.extra.map(e => `<li>${esc(e.text)}${timestamp(e.t)}</li>`).join('')}</ul>`) : ''}
${s.tasks.length ? section('Tarefas', `<ul class="task-list">${s.tasks.map(t => `<li class="task${t.done ? ' done' : ''}"><span class="check" role="img" aria-label="${t.done ? 'Concluída' : 'Por concluir'}"></span><div class="task-content"><div class="task-text">${esc(t.text)}</div><div class="task-meta">${esc(t.meta)}</div></div></li>`).join('')}</ul>`) : ''}
${s.transcript?.length ? section('Transcrição', s.transcript.map(t => `<article class="utterance"><div class="speaker"><strong>${esc(t.who)}</strong>${timestamp(t.t)}</div><p class="text">${esc(t.text)}</p>${t.tr ? `<p class="translation text">${esc(t.tr)}</p>` : ''}</article>`).join(''), `transcript${hasNotes ? ' new-page' : ''}`) : ''}
</main>
${brand ? `<footer class="brand-footer">${logo()}Notas criadas com a Ivueno</footer>` : ''}
</body></html>`;
}

module.exports = { renderMeetingPdf };
