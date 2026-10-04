import type { ReactNode } from 'react';
import { DocumentText } from '../shared/ui';
import { parseReplyBlocks, type ReplyBlock } from './reply-blocks';
import './reply-text.css';

function inline(text: string): ReactNode {
  return text.split(/(`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}
function blocks(content: ReplyBlock[]): ReactNode {
  return content.map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Heading = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
        return <Heading key={index}>{inline(block.text)}</Heading>;
      }
      case 'paragraph': return <p key={index}>{inline(block.text)}</p>;
      case 'quote': return <blockquote key={index}>{inline(block.text)}</blockquote>;
      case 'code': return <pre key={index}><code>{block.text}</code></pre>;
      case 'divider': return <hr key={index} />;
      case 'table': return <DocumentText key={index} text={block.text} />;
      case 'list': {
        const List = block.ordered ? 'ol' : 'ul';
        return <List key={index} start={block.ordered ? block.items[0]?.number : undefined}>
          {block.items.map((item, itemIndex) => <li key={itemIndex} value={block.ordered ? item.number : undefined}>{blocks(item.blocks)}</li>)}
        </List>;
      }
    }
  });
}
export function ReplyText({ text }: { text: string }) {
  return <div className="reply-text">{blocks(parseReplyBlocks(text))}</div>;
}
