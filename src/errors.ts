/**
 * Caller-fault errors.
 *
 * In its own module rather than in commands.ts because args.ts throws it too,
 * and commands.ts imports args.ts — a shared home avoids the cycle. Keeping the
 * type distinct is what lets index.ts exit 1 (bad invocation) rather than 2
 * (the API said no), which is the difference a script branches on.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
