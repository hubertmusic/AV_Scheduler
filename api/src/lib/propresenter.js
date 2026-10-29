// ProPresenter 7 imports plain text (File → Import). A line that holds only a section
// label (Verse 1, Chorus, Bridge…) becomes a Group; blank lines separate slides.

const LABEL = /^\s*[[(]?\s*((?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|tag|ending|interlude|refrain|instrumental|solo|vamp|turnaround|misc)(?:\s*\d+)?)\s*[\])]?\s*:?\s*$/i;

export function isSectionLabel(line) {
  return LABEL.test(line);
}

export function toProPresenterText(lyrics) {
  const out = [];
  for (const raw of String(lyrics || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const m = LABEL.exec(line);
    if (m) {
      // label starts a new group: make sure it is preceded by a blank line
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(m[1].replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()));
    } else if (line.trim() === '') {
      if (out.length && out[out.length - 1] !== '') out.push('');
    } else {
      out.push(line.trim());
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export function safeFileName(name, fallback = 'file') {
  return (String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)) || fallback;
}
