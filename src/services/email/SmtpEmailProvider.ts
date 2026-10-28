import nodemailer from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";

import type { SmtpEmailConfig } from "../../config/email";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./EmailProvider";

export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter<SMTPPool.SentMessageInfo>;

  constructor(private readonly config: SmtpEmailConfig) {
    const options: SMTPPool.Options & { maxRequeues: number } = {
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      // Nodemailer 9 otherwise requeues dropped connections automatically,
      // which would bypass the waitlist's ambiguous-delivery safeguards.
      maxRequeues: 0,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    };
    this.transporter = nodemailer.createTransport(options);
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
