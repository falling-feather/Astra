import { marked, type Token, type Tokens } from 'marked';
import { escapeHtml as e } from './html.ts';

function safeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Render a closed set of Markdown tokens; authored HTML and attributes never enter the DOM. */
export function markdown(source: string): string {
  return render(marked.lexer(source));
}

function render(tokens: Token[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'space':
          return '';
        case 'heading': {
          const node = token as Tokens.Heading;
          const depth = Math.max(2, Math.min(6, node.depth + 1));
          return `<h${depth}>${render(node.tokens)}</h${depth}>`;
        }
        case 'paragraph':
          return `<p>${render((token as Tokens.Paragraph).tokens)}</p>`;
        case 'text': {
          const node = token as Tokens.Text;
          return node.tokens ? render(node.tokens) : e(node.text);
        }
        case 'strong':
          return `<strong>${render((token as Tokens.Strong).tokens)}</strong>`;
        case 'em':
          return `<em>${render((token as Tokens.Em).tokens)}</em>`;
        case 'del':
          return `<del>${render((token as Tokens.Del).tokens)}</del>`;
        case 'codespan':
          return `<code>${e((token as Tokens.Codespan).text)}</code>`;
        case 'code':
          return `<pre><code>${e((token as Tokens.Code).text)}</code></pre>`;
        case 'blockquote':
          return `<blockquote>${render((token as Tokens.Blockquote).tokens)}</blockquote>`;
        case 'list': {
          const node = token as Tokens.List;
          const tag = node.ordered ? 'ol' : 'ul';
          return `<${tag}>${node.items.map((item) => `<li>${render(item.tokens)}</li>`).join('')}</${tag}>`;
        }
        case 'link': {
          const node = token as Tokens.Link;
          const title = render(node.tokens);
          return safeLink(node.href)
            ? `<a href="${e(node.href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
            : title;
        }
        case 'image': {
          const node = token as Tokens.Image;
          return safeLink(node.href)
            ? `<a href="${e(node.href)}" target="_blank" rel="noopener noreferrer">${e(node.text || '查看图片')}</a>`
            : e(node.text);
        }
        case 'table': {
          const node = token as Tokens.Table;
          return `<div class="portal-table-wrap"><table class="portal-table"><thead><tr>${node.header.map((cell) => `<th>${render(cell.tokens)}</th>`).join('')}</tr></thead><tbody>${node.rows.map((row) => `<tr>${row.map((cell) => `<td>${render(cell.tokens)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        }
        case 'br':
          return '<br>';
        case 'hr':
          return '<hr>';
        default:
          return e(token.raw);
      }
    })
    .join('');
}
