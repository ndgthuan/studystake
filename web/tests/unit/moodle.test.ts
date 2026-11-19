import { describe, expect, it } from 'vitest';
import { moodle_quiz_url } from '@/lib/moodle';

describe('moodle_quiz_url', () => {
  it('retains a Moodle subdirectory and uses the quiz instance ID', () => {
    expect(moodle_quiz_url('https://school.example/lms/', 42)).toBe('https://school.example/lms/mod/quiz/view.php?q=42');
  });

  it('rejects unsafe sites and invalid IDs', () => {
    expect(moodle_quiz_url('javascript:alert(1)', 42)).toBeNull();
    expect(moodle_quiz_url('https://user:pass@school.example', 42)).toBeNull();
    expect(moodle_quiz_url('https://school.example', 0)).toBeNull();
  });
});
