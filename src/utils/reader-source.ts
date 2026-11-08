/** Inert, lazily-created source for one floor. Only small ranges enter the live document. */
const ATOMIC = new Set(['IMG', 'VIDEO', 'AUDIO', 'BR', 'HR']);
const atomic = (element: Element) => ATOMIC.has(element.tagName) || (element.tagName === 'BUTTON' && element.classList.contains('reader-replies'));
export function readerFontWeight(weight: number, base = 400): number {
  return Math.max(100, Math.min(900, base + weight - 400));
}
export interface ReaderCursor { post: number; offset: number }
export interface ReaderPart {
  id: string;
  author_id: string | number;
  name: string;
  floor?: number;
  from: number;
  to: number;
  html: string;
  showAuthor: boolean;
  endsPost: boolean;
}
export interface ReaderHeading {
  kind: 'title' | 'author'; text: string; authorId?: string | number;
  left: number; top: number; width: number; height: number;
}
export interface ReaderPage {
  start: ReaderCursor; end: ReaderCursor; parts: ReaderPart[]; title: boolean;
  headings: ReaderHeading[];
  bottoms: number[];
}
export interface ReaderToken {
  from: number; to: number;
  kind: 'text' | 'break' | 'emoticon' | 'image' | 'video' | 'audio' | 'rule' | 'replies';
  text?: string; weight?: number; italic?: boolean; key?: string;
  width?: number; height?: number;
}
interface Leaf { node: Node; start: number; end: number }
type GraphemeSegmenter = { segment(text: string): Iterable<{ index: number }> };
const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter }).Segmenter;
const graphemeSegmenter = Segmenter ? new Segmenter('zh-CN', { granularity: 'grapheme' }) : undefined;

function leaves(root: Node): Leaf[] {
  const result: Leaf[] = [];
  let offset = 0;
  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (length) { result.push({ node, start: offset, end: offset + length }); offset += length; }
    } else if (node instanceof Element && atomic(node)) {
      result.push({ node, start: offset, end: ++offset });
    } else for (const child of node.childNodes) visit(child);
  }
  visit(root);
  return result;
}

export class ReaderSource {
  private template = document.createElement('template');
  private leaves: Leaf[];
  private graphemes = new WeakMap<Node, number[]>();
  readonly length: number;
  constructor(html: string, replies?: { postId: string; count: number }) {
    // template content is inert: parsing an unread floor cannot fetch its media.
    this.template.innerHTML = html;
    if (replies && Number.isFinite(replies.count) && replies.count > 0) {
      const button = this.template.content.ownerDocument.createElement('button');
      button.type = 'button'; button.className = 'reader-replies';
      button.dataset.postId = replies.postId;
      button.textContent = `${Math.floor(replies.count)} 条回复`;
      this.template.content.appendChild(button);
    }
    // Keep rich inline emphasis, but let the reader own the font metrics used for pagination.
    for (const element of this.template.content.querySelectorAll<HTMLElement>('*')) {
      if (atomic(element)) continue;
      for (const name of ['font-size', 'font-family', 'line-height', 'letter-spacing']) element.style.removeProperty(name);
      if (element.tagName === 'FONT') { element.removeAttribute('size'); element.removeAttribute('face'); }
    }
    this.leaves = leaves(this.template.content);
    this.length = this.leaves[this.leaves.length - 1]?.end ?? 0;
  }
  private point(offset: number): [Node, number] {
    const leaf = this.leaves[this.leafIndex(offset)];
    if (!leaf) return [this.template.content, 0];
    if (leaf.node.nodeType === Node.TEXT_NODE) return [leaf.node, Math.min(offset - leaf.start, leaf.end - leaf.start)];
    const parent = leaf.node.parentNode!;
    const index = Array.prototype.indexOf.call(parent.childNodes, leaf.node);
    return [parent, index + (offset >= leaf.end ? 1 : 0)];
  }
  private leafIndex(offset: number): number {
    let low = 0;
    let high = this.leaves.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.leaves[middle].end <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  safeOffset(offset: number, forward = false): number {
    const [node, index] = this.point(offset);
    const text = node.textContent || '';
    if (node.nodeType !== Node.TEXT_NODE || index <= 0 || index >= text.length) return offset;
    if (graphemeSegmenter && /[\p{Mark}\u200d\uFE0E\uFE0F\uD800-\uDFFF]/u.test(text.slice(index - 2, index + 2))) {
      let boundaries = this.graphemes.get(node);
      if (!boundaries) { boundaries = [...Array.from(graphemeSegmenter.segment(text), item => item.index), text.length]; this.graphemes.set(node, boundaries); }
      let low = 0;
      let high = boundaries.length - 1;
      while (low < high) { const middle = Math.floor((low + high) / 2); if (boundaries[middle] < index) low = middle + 1; else high = middle; }
      const boundary = boundaries[low] === index || forward ? boundaries[low] : boundaries[Math.max(0, low - 1)];
      return offset + boundary - index;
    }
    return /[\uDC00-\uDFFF]/.test(text[index]) ? offset + (forward ? 1 : -1) : offset;
  }
  /** An unseen reverse page should not begin in a word, emoji cluster or closing punctuation run. */
  pageStartOffset(offset: number): number {
    let safe = this.safeOffset(offset, true);
    const [node, index] = this.point(safe);
    const text = node.textContent || '';
    if (node.nodeType === Node.TEXT_NODE && /[A-Za-z0-9_]/.test(text[index - 1] || '') && /[A-Za-z0-9_]/.test(text[index] || '')) {
      const rest = text.slice(index).match(/^[A-Za-z0-9_]+/)?.[0].length || 0;
      if (rest <= 64) safe += rest;
    }
    for (let i = 0; i < 16; i++) {
      const [current, position] = this.point(safe);
      if (current.nodeType !== Node.TEXT_NODE || !/^[，。！？；：、）》】」』”’]/u.test(current.textContent?.slice(position) || '')) break;
      safe++;
    }
    return this.safeOffset(safe, true);
  }
  previousStart(to: number, maxUnits = 4096, maxLeaves = 64): number {
    const index = this.leafIndex(Math.max(0, to - 1));
    return this.safeOffset(Math.max(0, to - maxUnits, this.leaves[Math.max(0, index - maxLeaves + 1)]?.start ?? 0));
  }
  /** A bounded source window for Pretext. Offsets remain the original floor's UTF-16/atomic units. */
  tokens(from: number, maxUnits = 8192, maxLeaves = 128): ReaderToken[] {
    const result: ReaderToken[] = [];
    const limit = this.safeOffset(Math.min(this.length, from + maxUnits));
    const first = this.leafIndex(from);
    for (let i = first; i < this.leaves.length && i < first + maxLeaves; i++) {
      const leaf = this.leaves[i];
      if (leaf.start >= limit) break;
      const start = Math.max(from, leaf.start);
      const end = Math.min(limit, leaf.end);
      const node = leaf.node;
      if (node instanceof Element) {
        const kind = node.tagName === 'IMG' ? node.classList.contains('emoticon') ? 'emoticon' : 'image'
          : node.tagName === 'VIDEO' ? 'video' : node.tagName === 'AUDIO' ? 'audio' : node.tagName === 'HR' ? 'rule' : node.tagName === 'BUTTON' ? 'replies' : 'break';
        result.push({ from: start, to: end, kind,
          key: node.getAttribute('data-full-src') || node.getAttribute('data-remote-src') || node.getAttribute('src') || '',
          width: Number(node.getAttribute('width')) || undefined, height: Number(node.getAttribute('height')) || undefined });
        continue;
      }
      const block = node.parentElement?.closest('p, blockquote, li, div:not(.content-image-grid)');
      const previousBlock = this.leaves[i - 1]?.node.parentElement?.closest('p, blockquote, li, div:not(.content-image-grid)');
      if (start === leaf.start && block && block !== previousBlock && i > 0) result.push({ from: start, to: start, kind: 'break' });
      let weight: number | undefined;
      let italic: boolean | undefined;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = (parent as HTMLElement).style;
        if (weight === undefined) {
          const styledWeight = Number(style.fontWeight);
          if (styledWeight) weight = styledWeight;
          else if (/^(bold|bolder)$/.test(style.fontWeight)) weight = 700;
          else if (style.fontWeight === 'normal') weight = 400;
          else if (['B', 'STRONG'].includes(parent.tagName)) weight = 700;
          else if (parent.tagName === 'A' || parent.classList.contains('at-button')) weight = 500;
        }
        if (italic === undefined) {
          if (style.fontStyle) italic = /italic|oblique/.test(style.fontStyle);
          else if (['I', 'EM'].includes(parent.tagName)) italic = true;
        }
      }
      const text = node.textContent!.slice(start - leaf.start, end - leaf.start);
      let cursor = 0;
      for (const match of text.matchAll(/\r\n|[\n\r]/g)) {
        const index = match.index!;
        if (index > cursor) result.push({ kind: 'text', from: start + cursor, to: start + index, text: text.slice(cursor, index), weight: weight ?? 400, italic: italic ?? false });
        result.push({ kind: 'break', from: start + index, to: start + index + match[0].length });
        cursor = index + match[0].length;
      }
      if (cursor < text.length) result.push({ kind: 'text', from: start + cursor, to: end, text: text.slice(cursor), weight: weight ?? 400, italic: italic ?? false });
    }
    return result;
  }
  html(from: number, to: number, baseWeight = 400): string {
    if (to <= from) return '';
    const range = document.createRange();
    range.setStart(...this.point(from));
    range.setEnd(...this.point(to));
    let fragment: Node = range.cloneContents();
    // cloneContents omits the common ancestor; retain links/formatting even for a slice inside one text node.
    let parent = range.commonAncestorContainer;
    if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentNode!;
    while (parent !== this.template.content) {
      const wrapper = parent.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = wrapper;
      parent = parent.parentNode!;
    }
    // Serialize inside the template's inert document. Adopting images into the active
    // document, even a detached div, can start downloads during speculative reverse layout.
    const container = this.template.content.ownerDocument.createElement('div');
    container.appendChild(fragment);
    if (baseWeight !== 400) for (const element of container.querySelectorAll<HTMLElement>('*')) {
      const style = element.style.fontWeight;
      const weight = Number(style) || (/^(bold|bolder)$/.test(style) ? 700 : style === 'normal' ? 400
        : ['B', 'STRONG'].includes(element.tagName) ? 700 : element.tagName === 'A' || element.classList.contains('at-button') ? 500 : undefined);
      if (weight !== undefined) element.style.fontWeight = String(readerFontWeight(weight, baseWeight));
    }
    return container.innerHTML;
  }
}
