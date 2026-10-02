import nodemailer, { type Transporter } from 'nodemailer';

export interface OutgoingEmail {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** SMTP behind one interface: Mailpit locally, any SMTP provider in production. */
export abstract class Mailer {
  abstract send(email: OutgoingEmail): Promise<{ messageId: string }>;
  abstract close(): void;
}

export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;
  constructor(url: string) {
    super();
    this.transport = nodemailer.createTransport(url);
  }
  async send(email: OutgoingEmail) {
    const info = await this.transport.sendMail(email);
    return { messageId: String(info.messageId) };
  }
  close() {
    this.transport.close();
  }
}
