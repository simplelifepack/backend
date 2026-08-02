export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<void>;
  verify?(): Promise<void>;
}
