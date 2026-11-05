/**
 * 楼中楼叙事线：根据"回复 XXX :"反推每条回复所回应的上文，供悬停高亮使用。
 *
 * 接口没有"回复目标 pid"，只有 content 里一个 type 4 的 @ 元素（uid + 用户名），
 * 所以父节点只能按用户匹配。一个人连续回复同一对象的多条视为同一"轮"发言，整体纳入叙事线。
 */

export interface ChainAuthor {
  id: string | number;
  name: string;
  name_show?: string;
}

export interface ChainItem {
  author: ChainAuthor;
  content: unknown[];
}

export interface ReplyTarget {
  /** 目标用户 uid；缺失或为 0 时为空串 */
  uid: string;
  name: string;
}

interface AtElement {
  type?: unknown;
  text?: unknown;
  uid?: unknown;
}

/**
 * 从 content 中提取"回复 XXX"的目标：第一个紧跟在以"回复"结尾的文本之后的 @ 元素。
 * 正文里的普通 @ 前面没有"回复"，不会被误判。
 */
export function extractReplyTarget(content: unknown[]): ReplyTarget | null {
  if (!Array.isArray(content)) return null;
  for (let i = 1; i < content.length; i++) {
    const ele = content[i] as AtElement | null;
    if (!ele || Number(ele.type) !== 4) continue;
    const prev = content[i - 1] as AtElement | null;
    if (!prev || Number(prev.type) !== 0) continue;
    if (!String(prev.text ?? '').trim().endsWith('回复')) continue;
    const uid = String(ele.uid ?? '');
    return { uid: uid === '0' ? '' : uid, name: String(ele.text ?? '') };
  }
  return null;
}

/** 目标是否指向该作者：优先 uid，uid 缺失时按用户名 */
function targetIs(target: ReplyTarget | null, author: ChainAuthor | undefined): boolean {
  if (!target || !author) return false;
  if (target.uid) return String(author.id ?? '') === target.uid;
  return !!target.name && (author.name_show || author.name) === target.name;
}

export interface ReplyChainMeta {
  /** chains[i]：第 i 条回复的叙事线下标集合（自身 + 逐级回复的上文） */
  chains: Set<number>[];
  /** parents[i]：第 i 条回复所回应的更早那条的下标；-1 表示回复楼层本身 */
  parents: number[];
}

/**
 * 回复列表的子集的集合：chains[i] 为第 i 条回复的叙事线下标集合。
 *
 * 从第 i 条出发：先把同一作者、同一目标、位于它之前的回复（同一轮发言）收进来；
 * 再找父节点——目标用户的回复里，优先取"回复给当前作者"的最近一条，否则取该用户最近一条；
 * 父节点同样带上它那一轮，如此直到根。父节点永远在前面，不会成环。
 */
export function buildReplyChains(items: ChainItem[]): ReplyChainMeta {
  const targets = items.map(item => extractReplyTarget(item.content));
  const authorKey = (author: ChainAuthor | undefined): string => {
    const id = String(author?.id ?? '');
    return id && id !== '0' ? `u:${id}` : `n:${author?.name_show || author?.name || ''}`;
  };
  // 同一轮发言：作者相同且回复目标相同（都没有目标即都是直接回复楼层）
  const turnKeys = items.map((item, i) => `${authorKey(item.author)}|${targets[i] ? targets[i]!.uid || targets[i]!.name : ''}`);

  const parentOf = (i: number): number => {
    const target = targets[i];
    if (!target) return -1;
    const author = items[i].author;
    for (let j = i - 1; j >= 0; j--) {
      if (targetIs(target, items[j].author) && targetIs(targets[j], author)) return j;
    }
    for (let j = i - 1; j >= 0; j--) {
      if (targetIs(target, items[j].author)) return j;
    }
    return -1;
  };
  const parents = items.map((_, i) => parentOf(i));

  const chains = items.map((_, i) => {
    const chain = new Set<number>();
    for (let cur = i; cur >= 0; cur = parents[cur]) {
      for (let j = cur; j >= 0; j--) {
        if (turnKeys[j] === turnKeys[cur]) chain.add(j);
      }
    }
    return chain;
  });
  return { chains, parents };
}

/**
 * 点击第 index 条时的高亮集合：其叙事线（自身+同轮+逐级上文）之外，
 * 再收进所有叙事线经过其中条目的后续回复（子孙链）。
 * parents 永远在前，chain[j] 的元素都不大于 j，顺序单遍扫描即可收全。
 */
export function expandChain(chains: Set<number>[], index: number): Set<number> {
  const set = new Set(chains[index] ?? []);
  for (let j = 0; j < chains.length; j++) {
    if (set.has(j)) continue;
    for (const i of chains[j]) {
      if (set.has(i)) {
        for (const x of chains[j]) set.add(x);
        break;
      }
    }
  }
  return set;
}
