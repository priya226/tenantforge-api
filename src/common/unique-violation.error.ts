export class UniqueViolationError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Unique constraint violated', options);
    this.name = 'UniqueViolationError';
  }
}
