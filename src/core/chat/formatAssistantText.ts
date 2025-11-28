// src/core/chat/formatAssistantText.ts
export function formatAssistantText(raw: string): string {
  if (!raw) return "";

  const text = raw.trim();

  // If the text already has explicit paragraph breaks, leave it alone.
  const hasParagraphBreaks = text.includes("\n\n");

  // If it's short or already has paragraphs, do nothing.
  if (hasParagraphBreaks || text.length < 400) {
    return text;
  }

  // Split into sentences on . ! ? followed by space or line break.
  const sentenceRegex = /([^.!?]+[.!?]+)(\s+|$)/g;
  const sentences: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const sentence = match[1].trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
  }

  // Fallback: if we failed to split, return original.
  if (sentences.length === 0) {
    return text;
  }

  // Group 2–3 sentences per paragraph.
  const paragraphs: string[] = [];
  const MAX_SENTENCES_PER_PARAGRAPH = 3;

  for (let i = 0; i < sentences.length; i += MAX_SENTENCES_PER_PARAGRAPH) {
    const chunk = sentences.slice(i, i + MAX_SENTENCES_PER_PARAGRAPH).join(" ");
    paragraphs.push(chunk);
  }

  // Join with double newlines so markdown renders as separate paragraphs.
  const result = paragraphs.join("\n\n");

  // Lightweight debug log to confirm usage in the browser console.
  if (typeof window !== "undefined") {
    // Intentionally short log
    console.debug("[formatAssistantText]", {
      originalLen: text.length,
      paragraphs: paragraphs.length,
    });
  }

  return result;
}
