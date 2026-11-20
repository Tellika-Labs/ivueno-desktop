// Render a reviewable sample and exercise pagination in the app's PDF engine.
// Run: electron scripts/preview-meeting-pdf.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { toHtml } = require('../src/main/export');
const output = path.resolve(__dirname, '../project-design/meeting-pdf');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ivueno-pdf-preview-')));
const meeting = {
  title: 'Um novo capítulo para a equipa',
  startedAt: '2026-11-19T09:30:00Z', durationSeconds: 1920,
  attendees: [{ name: 'Ana Martins' }, { name: 'Bruno Costa' }, { name: 'Carla Lopes' }],
  summary: 'A equipa alinhou as prioridades para o lançamento de dezembro. Vamos simplificar a experiência de entrada, concluir os testes com clientes e preparar os materiais de comunicação. O próximo ponto de situação fica marcado para sexta-feira.',
  myNotes: 'Foco desta semana: tornar o primeiro passo mais simples.\nValidar a nova experiência com cinco clientes antes do lançamento.',
  aiBlocks: [{ mine: 'Uma entrada mais simples', add: 'Reduzir o formulário inicial e mostrar um exemplo de reunião logo no primeiro acesso.', t: '00:04:12' }],
  aiExtra: [{ text: 'O apoio ao cliente vai reunir as dúvidas mais frequentes para atualizar o guia.', t: '00:18:35' }],
  tasks: [
    { text: 'Partilhar o protótipo da nova experiência de entrada', owner: 'Ana Martins', due: '20 nov. 2026', done: true },
    { text: 'Agendar as sessões de teste com cinco clientes', owner: 'Bruno Costa', due: '23 nov. 2026' },
    { text: 'Preparar o plano de comunicação do lançamento', owner: 'Carla Lopes', due: '25 nov. 2026' },
  ],
  segments: [
    { startMs: 0, speakerKey: 'ana', text: 'Hoje vamos fechar as prioridades para o lançamento. Quero que cada pessoa saiba qual é o próximo passo.' },
    { startMs: 252000, speakerKey: 'bruno', text: 'Os clientes pediram uma entrada mais simples. Podemos começar com um exemplo e pedir os restantes dados depois.', translation: 'Customers asked for a simpler start. We can begin with an example and request the remaining details later.' },
    { startMs: 1115000, speakerKey: 'carla', text: 'Preparo os materiais de comunicação assim que tivermos o protótipo validado.' },
  ],
};
const opts = { nameOf: key => ({ ana: 'Ana Martins', bruno: 'Bruno Costa', carla: 'Carla Lopes' })[key], brand: true, includeTranscript: true };
let win;
const deadline = setTimeout(() => { console.error('PDF preview timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  win = new BrowserWindow({ show: false, width: 1000, height: 1250, webPreferences: { sandbox: true, backgroundThrottling: false } });
  const render = async (html, name, pageSize) => {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ pageSize, printBackground: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    fs.writeFileSync(path.join(output, name), pdf);
  };
  const html = toHtml(meeting, opts);
  fs.writeFileSync(path.join(output, 'meeting-template.html'), html);
  await render(html, 'meeting-template-a4.pdf', 'A4');
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  assert.equal(await win.webContents.executeJavaScript('document.fonts.check("12px Notes")'), true);
  assert.equal(await win.webContents.executeJavaScript('Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)'), true);
  assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  fs.writeFileSync(path.join(output, 'meeting-template.png'), (await win.webContents.capturePage()).toPNG());
  await render(html, 'meeting-template-letter.pdf', 'Letter');
  const long = { ...meeting, title: 'Planeamento e acompanhamento '.repeat(12), summary: meeting.summary.repeat(18), tasks: Array.from({ length: 25 }, (_, i) => ({ text: `${i + 1}. ${meeting.tasks[1].text}`, owner: 'Nome de participante muito comprido '.repeat(3), due: '23 nov. 2026' })), segments: Array.from({ length: 70 }, (_, i) => ({ ...meeting.segments[i % 3], startMs: i * 15000 })) };
  await render(toHtml(long, opts), 'meeting-stress-a4.pdf', 'A4');
  await render(toHtml({ ...meeting, title: 'Reunião', startedAt: null, attendees: [], summary: '', myNotes: '', aiBlocks: [], aiExtra: [], tasks: [], segments: [] }, { ...opts, brand: false }), 'meeting-minimal.pdf', 'A4');
  console.log(`PDF previews saved to ${output}`);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', cases: ['A4', 'Letter', 'long content', 'minimal content'], fonts: 'embedded', overflow: false }, null, 2));
}).catch(error => { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'failed', error: error.stack }, null, 2)); console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(deadline);
  if (win) win.destroy();
  app.exit(process.exitCode || 0);
});
