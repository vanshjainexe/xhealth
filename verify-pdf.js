// Test uploads using generated fictional PDFs, never a patient's report.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
let python = 'python';
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  if (line.startsWith('PYTHON_PATH=')) { python = line.slice(12).trim(); }
}
const generator = `
import io, sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
mode = sys.argv[1]
output = io.BytesIO()
pdf = canvas.Canvas(output)
lines = ['FICTIONAL PDF TEST', 'Hemoglobin: 13.8 g/dL', 'Total cholesterol: 210 mg/dL', 'Reference: below 200 mg/dL']
if mode == 'scan':
    image = Image.new('RGB', (1200, 1600), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 38)
    for index, line in enumerate(lines):
        draw.text((60, 80 + index * 75), line, font=font, fill='black')
    pdf.drawImage(ImageReader(image), 0, 0, width=595, height=842)
else:
    pdfmetrics.registerFont(TTFont('ReportFont', 'C:/Windows/Fonts/arial.ttf'))
    pdf.setFont('ReportFont', 16)
    lines.append('Unicode test: ≥ 70 and ≤ 99 µmol/L')
    for index, line in enumerate(lines):
        pdf.drawString(40, 780 - index * 35, line)
if mode == 'long':
    for page in range(40):
        pdf.showPage()
        pdf.setFont('ReportFont', 9)
        for row in range(12):
            pdf.drawString(40, 780 - row * 20, 'Administrative laboratory information. This line contains no patient measurement.')
        if page == 39:
            pdf.drawString(40, 450, 'Serum sodium: 139 mmol/L. Reference range: 135-145 mmol/L.')
            pdf.drawString(40, 425, 'END_OF_LONG_REPORT_98765')
pdf.save()
sys.stdout.buffer.write(output.getvalue())
`;

async function verify() {
  for (const mode of ['text', 'scan', 'long']) {
    const generated = spawnSync(python, ['-c', generator, mode], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr.toString());
    if (process.argv.includes('--fixtures')) {
      fs.writeFileSync('test-' + mode + '.pdf', generated.stdout);
    }
    const response = await fetch('http://localhost:3000/api/pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: generated.stdout
    });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    assert.ok(data.text.includes('13.8'), 'Hemoglobin value missing');
    assert.ok(data.text.includes('210'), 'Cholesterol value missing');
    if (mode !== 'scan') {
      assert.ok(data.text.includes('≥'));
      assert.ok(data.text.includes('µmol/L'));
    } else {
      assert.equal(data.ocr, true);
    }
    console.log(mode + ' PDF upload, values and Unicode: passed');
    if (mode === 'long') {
      assert.ok(data.text.length > 30000);
      assert.ok(data.text.includes('END_OF_LONG_REPORT_98765'));
      const analysis = await fetch('http://localhost:3000/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: data.text })
      });
      const result = await analysis.json();
      assert.equal(analysis.status, 200, result.error);
      assert.ok(result.insights.labs.some(function (lab) { return lab.value === 139 && /sodium/i.test(lab.name); }));
      const chat = await fetch('http://localhost:3000/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What sodium value is printed in my report? Reply with just the value and unit.', reports: [{ name: 'Fictional long PDF test', text: data.text, insights: result.insights }] })
      });
      assert.equal(chat.status, 200);
      const reply = (await chat.text()).split('\n').filter(Boolean).map(JSON.parse).map(function (event) { return event.text || ''; }).join('');
      assert.ok(reply.includes('139'));
      console.log('Long PDF: last page analyzed and available to chat, without truncation: passed');
    }
  }
  const invalid = await fetch('http://localhost:3000/api/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: 'not a PDF'
  });
  assert.equal(invalid.status, 400);
  console.log('Invalid PDF rejected with a readable error: passed');
}
verify().catch(function (error) { console.error(error.message); process.exitCode = 1; });
