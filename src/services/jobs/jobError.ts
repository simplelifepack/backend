export class JobError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "JobError";
    this.statusCode = statusCode;
  }
}
