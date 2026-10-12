import { pool } from '../db/pool';
import { Channel } from './notifier';
import { SmsChannel } from './smsChannel';
import { WhatsappChannel } from './whatsappChannel';

export interface NotifiableMember {
  id: number;
  phone: string;
  sms_opt_in: boolean;
  whatsapp_opt_in: boolean;
}

let sms: SmsChannel | null = null;
let whatsapp: WhatsappChannel | null = null;

// Sends only on channels the member opted into, and logs every attempt.
export async function notifyMember(member: NotifiableMember, body: string) {
  const channels: Channel[] = [];
  if (member.sms_opt_in) channels.push((sms ??= new SmsChannel()));
  if (member.whatsapp_opt_in) channels.push((whatsapp ??= new WhatsappChannel()));

  for (const channel of channels) {
    const result = await channel.send({ to: member.phone, body });
    await pool.query(
      `INSERT INTO notification_log (member_id, channel, body, success) VALUES ($1, $2, $3, $4)`,
      [member.id, channel.name, body, result.success]
    );
  }
}
