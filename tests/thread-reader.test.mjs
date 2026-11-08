import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/thread-reader.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } });
const { groupReadingPosts } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('only consecutive authors merge, retaining floor anchors', () => {
  const posts = [...'AAAABAAA'].map((author_id, i) => ({ id: i + 1, author_id }));
  assert.deepEqual(groupReadingPosts(posts).map(group => group.posts.map(post => post.id)), [[1, 2, 3, 4], [5], [6, 7, 8]]);
  assert.equal(groupReadingPosts(posts)[0].posts[0], posts[0]);
});

test('normalizes author IDs, merges page boundaries, and isolates unknown authors', () => {
  const firstPage = [{ id: 1, author_id: 123 }];
  const nextPage = [{ id: 2, author_id: '123' }, { id: 3 }, { id: 4 },
    { id: 5, author_id: 0 }, { id: 6, author_id: '0' }, { id: 7, author_id: ' ' }];
  assert.deepEqual(groupReadingPosts([...firstPage, ...nextPage]).map(group => group.posts.length), [2, 1, 1, 1, 1, 1]);
  assert.deepEqual(groupReadingPosts([]), []);
});
