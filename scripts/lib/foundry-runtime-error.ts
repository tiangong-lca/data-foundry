export class FoundryContextError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FoundryContextError";
    this.code = code;
  }
}
