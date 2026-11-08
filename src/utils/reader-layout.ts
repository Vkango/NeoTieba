import { clearCache, layoutWithLines, prepareWithSegments, setLocale } from '@chenglou/pretext';
import { layoutNextRichInlineLineRange, materializeRichInlineLineRange, prepareRichInline,
  type PreparedRichInline, type RichInlineCursor } from '@chenglou/pretext/rich-inline';
import type { ReaderCursor, ReaderHeading, ReaderPage, ReaderPart, ReaderSource, ReaderToken } from './reader-source';
import { readerFontWeight } from './reader-source';

export interface ReaderPost {
  id: string | number; author_id: string | number; floor?: number;
  author?: { name_show?: string; name?: string; user_name?: string };
}
export interface ReaderGeometry {
  width: number; height: number; columns: number; inset: number; gutter: number; top: number; bottom: number;
  columnWidth: number; fontFamily: string; fontSize: number; lineHeight: number; paragraphGap: number; floorGap: number;
  fontWeight: number; imageScale: number;
}
export function readerGeometry(width: number, height: number, fontFamily: string,
  options: Partial<Pick<ReaderGeometry, 'fontSize' | 'fontWeight' | 'imageScale'>> = {}): ReaderGeometry {
  const columns = width > 720 ? 2 : 1;
  const inset = Math.min(48, Math.max(20, width * .035));
  const gutter = columns === 2 ? Math.min(72, Math.max(40, width * .045)) : 0;
  const fontSize = options.fontSize ?? (width < 420 ? 18 : 20);
  return { width, height, columns, inset, gutter, top: 28, bottom: 28,
    columnWidth: Math.max(1, (width - inset * 2 - gutter * (columns - 1)) / columns), fontFamily, fontSize,
    lineHeight: Math.round(fontSize * 1.7), paragraphGap: 10, floorGap: 12,
    fontWeight: options.fontWeight ?? 400, imageScale: options.imageScale ?? 1 };
}
export function compareReaderCursor(a: ReaderCursor, b: ReaderCursor): number { return a.post - b.post || a.offset - b.offset; }
const sameAuthor = (a?: ReaderPost, b?: ReaderPost) => Boolean(a && b && String(a.author_id ?? '').trim()
  && String(a.author_id).trim() !== '0' && String(a.author_id).trim() === String(b.author_id ?? '').trim());

interface Paragraph {
  tokens: ReaderToken[]; prepared: PreparedRichInline; to: number; after: number; closed: boolean;
}

/** Line-first pagination. No speculative live DOM, CSS columns or per-character layout reads. */
export class ReaderPaginator {
  private prepared = new Map<string, Paragraph>();
  private sourceIds = new WeakMap<ReaderSource, number>();
  private nextSourceId = 0;
  private preparedUnits = 0;
  private preparations = 0;
  constructor(private posts: () => readonly ReaderPost[], private source: (index: number) => ReaderSource,
    private mediaSize: (key: string) => { width: number; height: number } | undefined) { setLocale('zh-CN'); }
  clear() { this.prepared.clear(); this.preparedUnits = 0; }
  private mediaBox(token: ReaderToken, g: ReaderGeometry, height: number): { width: number; height: number } {
    if (token.kind === 'audio') return { width: Math.min(320, g.columnWidth), height: 54 };
    if (token.kind === 'rule') return { width: g.columnWidth, height: 16 };
    const size = this.mediaSize(token.key || '') || (token.width && token.height ? { width: token.width, height: token.height }
      : { width: 640, height: token.kind === 'video' ? 360 : 480 });
    // Text-first reading: images are thumbnails; full-size viewing stays available on hover/click.
    const scale = token.kind === 'image'
      ? Math.min(Math.min(g.columnWidth, 160 * g.imageScale) / size.width, Math.min(height, 120 * g.imageScale) / size.height, 1)
      : Math.min(g.columnWidth / size.width, height / size.height, 1.25);
    return { width: size.width * scale, height: size.height * scale };
  }
  private imageRow(tokens: ReaderToken[], start: number, g: ReaderGeometry, height: number) {
    const items: { token: ReaderToken; width: number; height: number }[] = [];
    let width = 0;
    let rowHeight = 0;
    let end = start;
    for (let i = start; i < tokens.length;) {
      const token = tokens[i];
      if (token.kind !== 'image') break;
      const box = this.mediaBox(token, g, height);
      const nextWidth = width + (items.length ? 8 : 0) + box.width;
      if (items.length && nextWidth > g.columnWidth) break;
      items.push({ token, ...box }); width = nextWidth; rowHeight = Math.max(rowHeight, box.height);
      end = ++i;
      // Reply parsing inserts line breaks between images when the ordinary image grid is disabled.
      while (i < tokens.length && (tokens[i].kind === 'break' || (tokens[i].kind === 'text' && !tokens[i].text?.trim()))) i++;
    }
    return { items, width, height: rowHeight, end };
  }
  private firstBodyHeight(data: ReaderSource, g: ReaderGeometry, height: number): number {
    const tokens = data.tokens(0, 512, 24);
    const index = tokens.findIndex(token => token.kind !== 'break' && (token.kind !== 'text' || token.text?.trim()));
    const first = tokens[index];
    if (!first) return g.lineHeight;
    if (first.kind === 'image') return Math.min(this.imageRow(tokens, index, g, height).height * .78, height - 32);
    if (first.kind !== 'text' && first.kind !== 'emoticon') return Math.min(this.mediaBox(first, g, height).height * .78, height - 32);
    let end = index;
    while (end < tokens.length && (tokens[end].kind === 'text' || tokens[end].kind === 'emoticon')) end++;
    const runs = tokens.slice(index, end);
    const to = runs[runs.length - 1].to;
    const boundary = tokens[end];
    const paragraph = this.paragraph(data, runs, Boolean(boundary) || to >= data.length, boundary?.kind === 'break' ? boundary.to : to, g);
    const line = layoutNextRichInlineLineRange(paragraph.prepared, g.columnWidth);
    const two = line && layoutNextRichInlineLineRange(paragraph.prepared, g.columnWidth, line.end);
    return Math.min(two ? g.lineHeight * 2 : g.lineHeight, Math.max(g.lineHeight, height - 32));
  }
  private paragraph(data: ReaderSource, tokens: ReaderToken[], closed: boolean, after: number, g: ReaderGeometry): Paragraph {
    let id = this.sourceIds.get(data);
    if (id === undefined) { id = this.nextSourceId++; this.sourceIds.set(data, id); }
    const from = tokens[0].from;
    const to = tokens[tokens.length - 1].to;
    const key = `${id}:${from}:${to}:${after}:${closed}:${g.fontSize}:${g.fontFamily}:${g.fontWeight}`;
    const cached = this.prepared.get(key);
    if (cached) { this.prepared.delete(key); this.prepared.set(key, cached); return cached; }
    const prepared = prepareRichInline(tokens.map(token => token.kind === 'emoticon' ? { width: g.fontSize * 1.25 }
      : { text: token.text || '', font: `${token.italic ? 'italic ' : ''}${readerFontWeight(token.weight || 400, g.fontWeight)} ${g.fontSize}px ${g.fontFamily}` }), { whiteSpace: 'pre-wrap' });
    const result = { prepared, tokens, to, after, closed };
    this.prepared.set(key, result);
    this.preparedUnits += to - from;
    while (this.prepared.size > 64 || (this.preparedUnits > 65536 && this.prepared.size > 1)) {
      const oldest = this.prepared.keys().next().value!;
      const item = this.prepared.get(oldest)!;
      this.preparedUnits -= item.to - item.tokens[0].from;
      this.prepared.delete(oldest);
    }
    // Prepared handles own their measurements; trim shared glyph/word caches independently.
    if (++this.preparations % 256 === 0) clearCache();
    return result;
  }
  page(start: ReaderCursor, g: ReaderGeometry, title: string, stop?: ReaderCursor): ReaderPage {
    const posts = this.posts();
    const parts: ReaderPart[] = [];
    const headings: ReaderHeading[] = [];
    const bottoms = Array.from({ length: g.columns }, () => g.top);
    const bottom = Math.max(g.top + g.lineHeight, g.height - g.bottom);
    let column = 0;
    let y = g.top;
    let gap = 0;
    let cursor = { ...start };
    let units = 0;
    let floors = 0;
    const handledBreaks = new Set<string>();
    const x = () => g.inset + column * (g.columnWidth + g.gutter);
    function room(height: number): boolean {
      const spacing = y === g.top ? 0 : gap;
      if (y + spacing + height <= bottom + .1) { y += spacing; gap = 0; return true; }
      if (column + 1 >= g.columns) return false;
      column++; y = g.top; gap = 0;
      return true;
    }
    const add = (postIndex: number, from: number, to: number, html: string) => {
      if (to <= from) return;
      const post = posts[postIndex];
      let current = parts[parts.length - 1];
      if (!current || current.id !== String(post.id)) {
        current = { id: String(post.id), author_id: post.author_id, name: post.author?.name_show || post.author?.name || post.author?.user_name || '匿名用户',
          floor: post.floor, from, to, html: '', showAuthor: from === 0 && !sameAuthor(post, posts[postIndex - 1]), endsPost: false };
        parts.push(current);
      }
      current.to = to;
      current.html += html;
      current.endsPost = to >= this.source(postIndex).length;
      units += to - from;
      cursor = { post: postIndex, offset: to };
    };
    if (start.post === 0 && start.offset === 0 && title) {
      const font = `600 ${g.fontSize + 6}px ${g.fontFamily}`;
      const titleHeight = Math.max(36, Math.round((g.fontSize + 6) * 1.4));
      const lines = layoutWithLines(prepareWithSegments(title, font, { letterSpacing: (g.fontSize + 6) * -.015 }), g.columnWidth, titleHeight).lines;
      for (const line of lines) {
        if (!room(titleHeight)) break;
        headings.push({ kind: 'title', text: line.text, left: x(), top: y, width: g.columnWidth, height: titleHeight });
        y += titleHeight; bottoms[column] = y;
      }
      gap = 20;
    }
    page: while (cursor.post < posts.length && floors < 128 && units < 32768 && (!stop || compareReaderCursor(cursor, stop) < 0)) {
      const postIndex = cursor.post;
      const post = posts[postIndex];
      const data = this.source(postIndex);
      if (cursor.offset >= data.length) { cursor = { post: postIndex + 1, offset: 0 }; floors++; gap = Math.max(gap, g.floorGap); continue; }
      if (cursor.offset === 0 && !sameAuthor(post, posts[postIndex - 1])) {
        // Keep the author with actual body content, including an image-first floor.
        const body = this.firstBodyHeight(data, g, bottom - g.top);
        if (!room(24 + 8 + body)) break;
        headings.push({ kind: 'author', text: post.author?.name_show || post.author?.name || post.author?.user_name || '匿名用户', authorId: post.author_id,
          left: x(), top: y, width: g.columnWidth, height: 24 });
        y += 32; bottoms[column] = y;
      }
      // One source window, not the rest of the thread (or an entire enormous floor).
      let tokens = data.tokens(cursor.offset, 16384);
      if (stop?.post === postIndex) tokens = tokens.filter(token => token.from < stop.offset).map(token => token.to <= stop.offset ? token
        : { ...token, to: stop.offset, text: token.text?.slice(0, stop.offset - token.from) });
      tokens = tokens.filter(token => token.to > token.from || !handledBreaks.has(`${postIndex}:${token.from}`));
      if (!tokens.length) break;
      let i = 0;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token.kind === 'break') {
          handledBreaks.add(`${postIndex}:${token.from}`);
          add(postIndex, token.from, token.to, `<span class="reader-source-break" aria-hidden="true">${data.html(token.from, token.to)}</span>`);
          gap = Math.min(g.lineHeight, gap + g.paragraphGap);
          i++; continue;
        }
        if (token.kind !== 'text' && token.kind !== 'emoticon') {
          const row = token.kind === 'image' ? this.imageRow(tokens, i, g, bottom - g.top) : undefined;
          const box = row || this.mediaBox(token, g, bottom - g.top);
          let mediaWidth = box.width;
          let mediaHeight = box.height;
          const available = bottom - y - (y === g.top ? 0 : gap);
          // A modest shrink can avoid an almost-empty column; never crush a screenshot into a tiny slot.
          const heading = headings[headings.length - 1];
          const firstBelowHeading = heading?.kind === 'author' && heading.left === x() && heading.top === g.top && y === heading.top + 32;
          if (mediaHeight > available && available > 0 && (available >= mediaHeight * .78 || firstBelowHeading)) {
            const scale = available / mediaHeight; mediaHeight *= scale; mediaWidth *= scale;
          }
          if (!room(mediaHeight)) break page;
          const left = x() + (g.columnWidth - mediaWidth) / 2;
          if (row) {
            const scale = mediaWidth / row.width;
            let imageLeft = left;
            let from = token.from;
            for (const image of row.items) {
              if (image.token.from > from) add(postIndex, from, image.token.from,
                `<span class="reader-source-break" aria-hidden="true">${data.html(from, image.token.from)}</span>`);
              const imageWidth = image.width * scale;
              const imageHeight = image.height * scale;
              add(postIndex, image.token.from, image.token.to,
                `<div class="reader-media" data-column="${column}" style="left:${imageLeft}px;top:${y + (mediaHeight - imageHeight) / 2}px;width:${imageWidth}px;height:${imageHeight}px">${data.html(image.token.from, image.token.to)}</div>`);
              imageLeft += imageWidth + 8 * scale;
              from = image.token.to;
            }
          } else add(postIndex, token.from, token.to,
            `<div class="reader-media" data-column="${column}" style="left:${left}px;top:${y}px;width:${mediaWidth}px;height:${mediaHeight}px">${data.html(token.from, token.to)}</div>`);
          y += mediaHeight; bottoms[column] = y; gap = g.paragraphGap;
          i = row?.end ?? i + 1; continue;
        }
        const from = i;
        while (i < tokens.length && (tokens[i].kind === 'text' || tokens[i].kind === 'emoticon')) i++;
        const runs = tokens.slice(from, i);
        if (runs.every(run => run.kind === 'text' && !run.text?.trim())) {
          const end = runs[runs.length - 1].to;
          add(postIndex, runs[0].from, end, `<span class="reader-source-break" aria-hidden="true">${data.html(runs[0].from, end)}</span>`);
          continue;
        }
        const boundary = tokens[i];
        const to = runs[runs.length - 1].to;
        const naturalEnd = Boolean(boundary) || to >= data.length;
        const closed = naturalEnd || (stop?.post === postIndex && to >= stop.offset);
        const paragraph = this.paragraph(data, runs, closed, boundary?.kind === 'break' ? boundary.to : to, g);
        let lineCursor: RichInlineCursor | undefined;
        let currentOffset = runs[0].from;
        while (true) {
          const range = layoutNextRichInlineLineRange(paragraph.prepared, g.columnWidth, lineCursor);
          if (!range) break;
          const line = materializeRichInlineLineRange(paragraph.prepared, range);
          const next = layoutNextRichInlineLineRange(paragraph.prepared, g.columnWidth, range.end);
          if (!next && !closed && currentOffset > runs[0].from) {
            // Do not manufacture a short line at a preparation-window boundary. Resume with lookahead.
            break;
          }
          // Avoid a one-line paragraph orphan or widow, without keeping whole paragraphs together.
          const finalTwo = naturalEnd && next && !layoutNextRichInlineLineRange(paragraph.prepared, g.columnWidth, next.end);
          if (next && (currentOffset === runs[0].from || finalTwo) && !room(g.lineHeight * 2)) break page;
          if (!room(g.lineHeight)) break page;
          let end = currentOffset;
          for (const fragment of line.fragments) {
            const run = runs[fragment.itemIndex];
            end = Math.max(end, run.kind === 'emoticon' ? run.to : run.from + fragment.sourceEnd);
          }
          if (!next && closed) end = paragraph.to;
          if (end <= currentOffset) end = paragraph.to;
          const text = line.fragments.map(fragment => fragment.text).join('');
          const justify = Boolean(next || !naturalEnd) && line.width >= g.columnWidth * (/\p{Script=Han}/u.test(text) ? .78 : .88);
          add(postIndex, currentOffset, end,
            `<div class="reader-line${justify ? ' justified' : ''}" dir="auto" data-column="${column}" style="left:${x()}px;top:${y}px;width:${g.columnWidth}px;height:${g.lineHeight}px">${data.html(currentOffset, end, g.fontWeight)}</div>`);
          currentOffset = end;
          y += g.lineHeight; bottoms[column] = y;
          lineCursor = range.end;
          if (!next) break;
        }
        if (cursor.offset < paragraph.to) break;
      }
      if (cursor.offset >= data.length) { cursor = { post: postIndex + 1, offset: 0 }; floors++; gap = Math.max(gap, g.floorGap); }
      if (stop && compareReaderCursor(cursor, stop) >= 0) break;
    }
    // Atomic source boundaries and decorations are immutable; rendering a page cannot re-wrap its prefix.
    return { start: { ...start }, end: cursor, parts, title: start.post === 0 && start.offset === 0, headings, bottoms };
  }
}
