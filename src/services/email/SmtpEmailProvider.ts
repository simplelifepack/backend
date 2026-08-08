import nodemailer from "nodemailer";

import type { SmtpEmailConfig } from "../../config/email";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./EmailProvider";

export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: SmtpEmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail({
      from: this.config.mailFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });

    return {
      messageId: info.messageId,
    };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
