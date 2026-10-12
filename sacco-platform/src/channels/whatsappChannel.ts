import twilio from 'twilio';
import { Channel, AlertMessage, SendResult } from './notifier';

export class WhatsappChannel implements Channel {
  name = 'whatsapp';
  private client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

  async send(message: AlertMessage): Promise<SendResult> {
    try {
      const result = await this.client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${message.to}`,
        body: message.body,
      });
      return { success: true, providerId: result.sid };
    } catch (err) {
      console.error('WhatsApp send failed', err);
      return { success: false };
    }
  }
}
