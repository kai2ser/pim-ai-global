import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mt-6 mb-3 font-heading text-xl font-bold text-[#1d212b]">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-5 mb-2 font-heading text-lg font-semibold text-[#1d212b]">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-4 mb-2 font-heading text-base font-semibold text-[#1d212b]">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="mb-3 leading-relaxed text-[#1d212b]">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 ml-5 list-disc space-y-1 text-[#1d212b]">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 ml-5 list-decimal space-y-1 text-[#1d212b]">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-[#1d212b]">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-[#374696]">{children}</em>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-4 border-[#4472c4]/30 pl-4 italic text-[#778899]">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code className="block overflow-x-auto rounded-lg bg-[#1c2027] p-4 text-xs text-gray-200">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-[#f0f5ff] px-1.5 py-0.5 text-xs font-medium text-[#374696]">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="mb-3">{children}</pre>,
        table: ({ children }) => (
          <div className="mb-3 overflow-x-auto rounded-lg border border-[#dce4f0]">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[#f0f5ff]/50">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-semibold text-[#1d212b]">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-t border-[#dce4f0] px-3 py-2 text-[#1d212b]">
            {children}
          </td>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4472c4] underline hover:text-[#374696]"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-4 border-[#dce4f0]" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
