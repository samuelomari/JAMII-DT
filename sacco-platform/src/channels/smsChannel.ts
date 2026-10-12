import AfricasTalking from 'africastalking';
import { Channel, AlertMessage, SendResult } from './notifier';

export class SmsChannel implements Channel {
  name = 'sms';
  private sms = AfricasTalking({
    apiKey: process.env.AT_API_KEY!,
    username: process.env.AT_USERNAME!,
  }).SMS;

  async send(message: AlertMessage): Promise<SendResult> {
    try {
      const options: Record<string, unknown> = {
        to: [message.to],
        message: message.body,
      };
      if (process.env.AT_SHORTCODE) options.from = process.env.AT_SHORTCODE;
      const result = await this.sms.send(options);
      return { success: true, providerId: JSON.stringify(result) };
    } catch (err) {
      console.error('SMS send failed', err);
      return { success: false };
    }
  }
}
