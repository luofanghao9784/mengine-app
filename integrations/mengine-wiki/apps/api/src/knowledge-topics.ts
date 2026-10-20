import { createHash } from 'node:crypto';
// Input MUST already be filtered by current source permissions. Never look up
// additional sources here: even the count and titles are permission-sensitive.
export function groupKnowledgeTopics(items: any[]): any[] {
  const groups = new Map<string, any>();
  for (const k of items) {
    if (!k.topicKey || k.origin !== 'deployment') { groups.set(k.id, k); continue; }
    // Same key with changed rules stays separate pending review, not last-write-wins.
    const id = 'topic-' + createHash('sha256').update(JSON.stringify([k.topicKey,k.title,k.content])).digest('hex').slice(0,24);
    const source = {id:k.sourceId,title:k.sourceTitle,version:k.sourceVersion,knowledgeId:k.id,revision:k.revision,evidence:k.evidence};
    const old = groups.get(id);
    if (old) { old.sources.push(source); continue; }
    groups.set(id,{...k,id,sources:[source]});
  }
  return [...groups.values()];
}
