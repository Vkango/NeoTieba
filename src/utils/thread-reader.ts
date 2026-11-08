/** Only adjacent, known authors form a reading block. Keep the original posts as anchors. */
export function groupReadingPosts<T extends { id: string | number; author_id?: string | number }>(posts: T[]) {
  const groups: { id: string; authorId: string; posts: T[] }[] = [];
  for (const post of posts) {
    const authorId = String(post.author_id ?? '').trim();
    const known = Boolean(authorId && authorId !== '0');
    const previous = groups[groups.length - 1];
    if (known && previous?.authorId === authorId) previous.posts.push(post);
    else groups.push({ id: String(post.id), authorId: known ? authorId : '', posts: [post] });
  }
  return groups;
}
