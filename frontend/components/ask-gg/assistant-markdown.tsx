'use client';

// The ONLY file under components/ask-gg allowed to import
// react-markdown / remark-gfm.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders assistant-message content as Markdown. Claude's answers
 *  use `**bold**`, `## headers`, `- bullet lists`, fenced code, and
 *  inline `code` — without proper rendering they show as literals.
 *  Custom components apply Gun Galore's text-tertiary/primary
 *  colour tokens + tight spacing so the chat bubble doesn't bloat.
 *  GFM enabled for tables (load-data tables benefit) + autolinks. */
export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="ask-gg-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Cap heading sizes — assistant occasionally emits H1; keep
          // every heading visually subordinate to the page chrome.
          h1: ({ children }) => (
            <p style={mdHeadingStyle(16)}>{children}</p>
          ),
          h2: ({ children }) => (
            <p style={mdHeadingStyle(15)}>{children}</p>
          ),
          h3: ({ children }) => (
            <p style={mdHeadingStyle(14)}>{children}</p>
          ),
          h4: ({ children }) => (
            <p style={mdHeadingStyle(14)}>{children}</p>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 8px', lineHeight: 1.55 }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {children}
            </strong>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 3, lineHeight: 1.5 }}>{children}</li>
          ),
          code: ({ children, ...props }) => {
            const isInline = !(props as { className?: string }).className;
            return isInline ? (
              <code
                style={{
                  background: 'var(--bg-inset)',
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {children}
              </code>
            ) : (
              <code>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre
              style={{
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                overflowX: 'auto',
                margin: '0 0 8px',
              }}
            >
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--red)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0 0 8px',
                paddingLeft: 10,
                borderLeft: '2px solid var(--border-hover)',
                color: 'var(--text-secondary)',
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '0 0 8px' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  width: '100%',
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                border: '0.5px solid var(--border)',
                padding: '4px 8px',
                background: 'var(--bg-inset)',
                textAlign: 'left',
                fontWeight: 600,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                border: '0.5px solid var(--border)',
                padding: '4px 8px',
              }}
            >
              {children}
            </td>
          ),
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '0.5px solid var(--border)',
                margin: '10px 0',
              }}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function mdHeadingStyle(fontSize: number): React.CSSProperties {
  return {
    margin: '8px 0 4px',
    fontSize,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.35,
  };
}
