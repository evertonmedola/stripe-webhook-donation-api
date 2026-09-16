import { isValidTransition } from './order-state-machine';

describe('isValidTransition', () => {
  it.each([
    ['pending', 'paid'],
    ['pending', 'failed'],
    ['paid', 'refunded'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it.each([
    ['paid', 'pending'],
    ['refunded', 'paid'],
    ['failed', 'paid'],
    ['pending', 'refunded'],
    ['refunded', 'refunded'],
    ['pending', 'pending'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });
});
