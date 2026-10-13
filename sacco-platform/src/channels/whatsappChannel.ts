import twilio, { Twilio } from 'twilio';
import { Channel, AlertMessage, SendResult } from './notifier';

const WHATSAPP_PREFIX = 'whatsapp:';

// TWILIO_WHATSAPP_NUMBER is often configured with the `whatsapp:` prefix
// already; normalise so we never produce `whatsapp:whatsapp:+1415...`.
export function normalizeWhatsappAddress(number: string): string {
  return number.startsWith(WHATSAPP_PREFIX) ? number : `${WHATSAPP_PREFIX}${number}`;
}

export class WhatsappChannel implements Channel {
  name = 'whatsapp';
  private client: Twilio | null = null;

  // Built lazily so unset sandbox credentials fail the individual send
  // (and get logged) instead of throwing when the channel is constructed.
  private get twilioClient() {
    this.client ??= twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    return this.client;
  }

  async send(message: AlertMessage): Promise<SendResult> {
    try {
      const from = process.env.TWILIO_WHATSAPP_NUMBER;
      if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN || !from) {
        throw new Error('Twilio WhatsApp credentials are not configured');
      }
      const result = await this.twilioClient.messages.create({
        from: normalizeWhatsappAddress(from),
        to: normalizeWhatsappAddress(message.to),
        body: message.body,
      });
      return { success: true, providerId: result.sid };
    } catch (err) {
      console.error('WhatsApp send failed', err);
      return { success: false };
    }
  }
}
