/** Milliseconds since epoch. Injected everywhere so tests can move time forward. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
