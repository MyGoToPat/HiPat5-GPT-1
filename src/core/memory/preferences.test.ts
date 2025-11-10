import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rankTopPreferences } from './preferences';
import { getEmbeddings } from '@/core/router/embed';

// Mock the embed function
vi.mock('@/core/router/embed', () => ({
  getEmbeddings: vi.fn()
}));

// Mock supabase client
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit: vi.fn(() => ({
          data: [],
          error: null
        }))
      }))
    }))
  }))
};

describe('rankTopPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Case A: empty prefs → []', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            data: [],
            error: null
          }))
        }))
      }))
    });

    const result = await rankTopPreferences('user-123', 'test query', mockSupabase as any, 5);
    expect(result).toEqual([]);
  });

  it('Case B: fixed vectors → orders by cosine', async () => {
    // Mock preferences data
    const mockPrefs = [
      { preference_text: 'I prefer low carb meals' },
      { preference_text: 'I love high protein foods' },
      { preference_text: 'I enjoy vegetarian options' }
    ];

    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            data: mockPrefs,
            error: null
          }))
        }))
      }))
    });

    // Mock embeddings: query vector and preference vectors
    // Query: [1, 0, 0] (high similarity with first pref)
    // Pref 1: [1, 0, 0] (cosine = 1.0)
    // Pref 2: [0, 1, 0] (cosine = 0.0)
    // Pref 3: [0, 0, 1] (cosine = 0.0)
    const mockQueryVec = [1, 0, 0];
    const mockPrefVecs = [
      [1, 0, 0], // High similarity
      [0, 1, 0], // No similarity
      [0, 0, 1] // No similarity
    ];

    vi.mocked(getEmbeddings).mockResolvedValueOnce([mockQueryVec]);
    vi.mocked(getEmbeddings).mockResolvedValueOnce(mockPrefVecs);

    const result = await rankTopPreferences('user-123', 'low carb', mockSupabase as any, 5);

    expect(result.length).toBe(3);
    // Verify ordering: highest score first
    expect(result[0].preference_text).toBe('I prefer low carb meals');
    expect(result[0].score).toBeCloseTo(1.0, 5);
    expect(result[1].score).toBeCloseTo(0.0, 5);
    expect(result[2].score).toBeCloseTo(0.0, 5);
  });

  it('Case C: embeddings throw → [] and console.warn called', async () => {
    const mockPrefs = [
      { preference_text: 'test preference' }
    ];

    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            data: mockPrefs,
            error: null
          }))
        }))
      }))
    });

    // Mock embed failure
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getEmbeddings).mockRejectedValueOnce(new Error('Embed failed'));

    const result = await rankTopPreferences('user-123', 'test query', mockSupabase as any, 5);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[preferences] Failed to embed query'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('Case D: preferences embed fails → [] and console.warn called', async () => {
    const mockPrefs = [
      { preference_text: 'test preference' }
    ];

    mockSupabase.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            data: mockPrefs,
            error: null
          }))
        }))
      }))
    });

    // Query embed succeeds, preferences embed fails
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getEmbeddings).mockResolvedValueOnce([[1, 0, 0]]);
    vi.mocked(getEmbeddings).mockRejectedValueOnce(new Error('Pref embed failed'));

    const result = await rankTopPreferences('user-123', 'test query', mockSupabase as any, 5);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[preferences] Failed to embed preferences'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
