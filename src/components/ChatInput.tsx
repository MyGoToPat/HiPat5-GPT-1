import React, { useCallback, useRef, useEffect } from 'react';

type ChatInputProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  isSending?: boolean;
  maxRows?: number;
};

export default function ChatInput({
  value,
  onChange,
  onSend,
  placeholder = 'Ask me anything',
  isSending = false,
  maxRows = 6,
}: ChatInputProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    const lineH = parseInt(getComputedStyle(ta).lineHeight || '20', 10);
    const max = lineH * maxRows;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, maxRows]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter (without Shift) sends the message
      // Shift+Enter creates a new line
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend]
  );

  return (
    <div className='flex-1'>
      <label htmlFor='chat-ta' className='sr-only'>
        Type your message
      </label>
      <textarea
        id='chat-ta'
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={isSending}
        className='w-full resize-none bg-white text-neutral-900 border border-black/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed'
        aria-multiline='true'
      />
    </div>
  );
}
