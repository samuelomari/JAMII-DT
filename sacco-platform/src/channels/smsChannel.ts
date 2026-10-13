import { Channel, AlertMessage, SendResult } from './notifier';
import { AfricasTalkingClient, SmsSendOptions, africasTalkingClient } from './africastalkingClient';

export class SmsChannel implements Channel {
  name = 'sms';
  private client: AfricasTalkingClient | null = null;

  // Built lazily and only when a message is actually sent, so missing
  // credentials surface as a failed send (logged) instead of a crash on boot.
  private get sms() {
    this.client ??= africasTalkingClient({
      apiKey: process.env.AT_API_KEY ?? '',
      username: process.env.AT_USERNAME ?? '',
    });
    return this.client.SMS;
  }

  async send(message: AlertMessage): Promise<SendResult> {
    try {
      const options: SmsSendOptions = {
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
