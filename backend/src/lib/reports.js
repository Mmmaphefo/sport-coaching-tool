// Report generation for T20: CSV + PDF exports of match and season reports.
// The PDF writer is deliberately dependency-free — a minimal PDF 1.4 with one
// Helvetica font object and one content stream per page is all we need for
// text reports, and it keeps the install footprint unchanged.

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Minimal PDF writer
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN_X = 48;
const MARGIN_TOP = 800;
const BOTTOM_LIMIT = 48;
const LINE_HEIGHT = 14;

// PDF text strings are WinAnsi (close to latin-1). Escape specials and replace
// anything we can't represent so byte offsets stay in sync with char counts.
function sanitizePdfText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .split('')
    .map((ch) => (ch.charCodeAt(0) <= 255 ? ch : '?'))
    .join('');
}

// lines: array of { text, size?, bold?, gapAfter? }; long lists are paginated
// automatically (a line that doesn't fit starts a new page).
function buildPdf(lines) {
  const pages = [];
  let currentPage = [];
  let y = MARGIN_TOP;

  function startNewPage() {
    if (currentPage.length > 0) pages.push(currentPage);
    currentPage = [];
    y = MARGIN_TOP;
  }

  for (const line of lines) {
    const size = line.size || 10;
    const advance = line.gapAfter ?? LINE_HEIGHT * (size / 10);
    if (y - advance < BOTTOM_LIMIT) startNewPage();

    let text = line.text ?? '';
    // Rough wrap width so nothing runs off the right edge.
    const maxChars = Math.max(40, Math.floor((PAGE_WIDTH - MARGIN_X * 2) / (size * 0.55)));
    let first = true;
    while (text.length > maxChars) {
      currentPage.push({ text: text.slice(0, maxChars), size, bold: line.bold });
      text = text.slice(maxChars);
      y -= advance;
      if (y - advance < BOTTOM_LIMIT) startNewPage();
      first = false;
    }
    if (!first && text.length > 0) {
      // remainder goes on whatever page we're on now
    }
    currentPage.push({ text, size, bold: line.bold });
    y -= advance;
  }
  if (currentPage.length > 0) pages.push(currentPage);
  if (pages.length === 0) pages.push([]);

  // Object numbering: 1 catalog, 2 pages tree, 3/4 fonts, then per page:
  // page object (odd slot) + content stream (even slot).
  const pageIds = [];
  const contentIds = [];
  let nextId = 5;
  for (let i = 0; i < pages.length; i++) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }
  const totalObjects = nextId - 1;

  const chunks = [];
  let offset = 0;
  const offsets = [];

  function push(str) {
    const buf = Buffer.from(str, 'latin1');
    chunks.push(buf);
    offset += buf.length;
  }

  function emitObject(id, body) {
    offsets[id] = offset;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  }

  push('%PDF-1.4\n');
  emitObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  emitObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
  emitObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  emitObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  for (let i = 0; i < pages.length; i++) {
    const parts = ['BT'];
    let yy = MARGIN_TOP;
    for (const line of pages[i]) {
      parts.push(`/${line.bold ? 'F2' : 'F1'} ${line.size} Tf`);
      parts.push(`1 0 0 1 ${MARGIN_X} ${yy} Tm`);
      parts.push(`(${sanitizePdfText(line.text)}) Tj`);
      yy -= line.gapAfter ?? LINE_HEIGHT * (line.size / 10);
    }
    parts.push('ET');
    const stream = parts.join('\n') + '\n';

    emitObject(
      contentIds[i],
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`
    );
    emitObject(
      pageIds[i],
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
    );
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= totalObjects; id++) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

module.exports = { buildCsv, buildPdf };
