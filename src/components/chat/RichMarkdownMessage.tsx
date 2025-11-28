import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RichMarkdownMessageProps {
  text: string;
}

export const RichMarkdownMessage: React.FC<RichMarkdownMessageProps> = ({ text }) => {
  return (
    <div className="markdown-content text-gray-100">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({node, ...props}) => <h1 className="text-xl font-bold text-white mt-4 mb-2 first:mt-0" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-lg font-bold text-blue-300 mt-4 mb-2 first:mt-0" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-base font-semibold text-blue-200 mt-3 mb-1" {...props} />,
          ul: ({node, ...props}) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
          ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
          li: ({node, ...props}) => <li className="pl-1" {...props} />,
          p: ({node, ...props}) => <p className="mb-3 leading-relaxed last:mb-0 whitespace-pre-wrap" {...props} />,
          a: ({node, ...props}) => (
            <a 
              className="text-blue-400 hover:text-blue-300 underline decoration-dotted underline-offset-4 transition-colors" 
              target="_blank" 
              rel="noreferrer noopener" 
              {...props} 
            />
          ),
          strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
          em: ({node, ...props}) => <em className="italic text-gray-300" {...props} />,
          code: ({node, ...props}) => <code className="bg-gray-700 px-1 py-0.5 rounded text-sm font-mono text-blue-200" {...props} />,
          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-600 pl-4 py-1 my-2 text-gray-400 italic" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};


