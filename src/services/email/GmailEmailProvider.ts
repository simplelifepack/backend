import nodemailer from "nodemailer";

import type { GmailEmailConfig } from "../../config/email";
import type { EmailProvider, SendEmailInput } from "./EmailProvider";

export class GmailEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: GmailEmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpAppPassword,
      },
    });
  }

  async sendEmail(input: SendEmailInput): Promise<void> {
    await this.transporter.sendMail({
      from: {
        name: this.config.fromName,
        address: this.config.fromAddress,
      },
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
        "X-Lifepack-Message-Type": "authentication",
      },
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
