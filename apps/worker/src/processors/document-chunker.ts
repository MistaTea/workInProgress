export interface DocumentChunkDraft {
  chunkIndex: number;
  chunkText: string;
  metadata: {
    startOffset: number;
    endOffset: number;
    characterCount: number;
  };
}

export interface DocumentChunkOptions {
  maxCharacters?: number;
  overlapCharacters?: number;
}

const DEFAULT_MAX_CHARACTERS = 1_200;
const DEFAULT_OVERLAP_CHARACTERS = 200;

function findPreferredEnd(sourceText: string, startOffset: number, maximumEnd: number) {
  if (maximumEnd >= sourceText.length) {
    return sourceText.length;
  }

  const minimumPreferredEnd = startOffset + Math.floor((maximumEnd - startOffset) * 0.6);
  for (const separator of ["\n\n", "\n", ". ", " "]) {
    const separatorIndex = sourceText.lastIndexOf(separator, maximumEnd);
    if (separatorIndex >= minimumPreferredEnd) {
      return separatorIndex + separator.length;
    }
  }

  return maximumEnd;
}

function trimChunkBounds(sourceText: string, startOffset: number, endOffset: number) {
  let start = startOffset;
  let end = endOffset;

  while (start < end && /\s/.test(sourceText[start] ?? "")) {
    start += 1;
  }

  while (end > start && /\s/.test(sourceText[end - 1] ?? "")) {
    end -= 1;
  }

  return { start, end };
}

export function chunkDocumentText(sourceText: string, options: DocumentChunkOptions = {}): DocumentChunkDraft[] {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const overlapCharacters = options.overlapCharacters ?? DEFAULT_OVERLAP_CHARACTERS;

  if (maxCharacters < 100) {
    throw new Error("Document chunk size must be at least 100 characters.");
  }

  if (overlapCharacters < 0 || overlapCharacters >= maxCharacters) {
    throw new Error("Document chunk overlap must be non-negative and smaller than the chunk size.");
  }

  const chunks: DocumentChunkDraft[] = [];
  let cursor = 0;

  while (cursor < sourceText.length) {
    const maximumEnd = Math.min(cursor + maxCharacters, sourceText.length);
    const preferredEnd = findPreferredEnd(sourceText, cursor, maximumEnd);
    const { start, end } = trimChunkBounds(sourceText, cursor, preferredEnd);

    if (end > start) {
      chunks.push({
        chunkIndex: chunks.length,
        chunkText: sourceText.slice(start, end),
        metadata: {
          startOffset: start,
          endOffset: end,
          characterCount: end - start
        }
      });
    }

    if (preferredEnd >= sourceText.length) {
      break;
    }

    cursor = Math.max(preferredEnd - overlapCharacters, cursor + 1);
  }

  return chunks;
}
