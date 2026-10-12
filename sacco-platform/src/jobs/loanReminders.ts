import cron from 'node-cron';
import { pool } from '../db/pool';
import { notifyMember } from '../channels/notifyMember';

export async function checkLoanDueDates() {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.phone, m.sms_opt_in, m.whatsapp_opt_in,
            l.amount_due, l.due_date, l.status
     FROM loans l
     JOIN members m ON m.id = l.member_id
     WHERE l.status IN ('active', 'arrears')
       AND (l.due_date = CURRENT_DATE + INTERVAL '3 days'
            OR l.due_date = CURRENT_DATE
            OR l.status = 'arrears')`
  );

  for (const row of rows) {
    const due = new Date(row.due_date).toDateString();
    const body =
      row.status === 'arrears'
        ? `Dear ${row.name}, your loan repayment of KSh ${row.amount_due} (due ${due}) is overdue. Please pay via M-Pesa Paybill to clear arrears. - Jamii DT Sacco`
        : `Dear ${row.name}, your loan repayment of KSh ${row.amount_due} is due on ${due}. Please pay via M-Pesa Paybill. - Jamii DT Sacco`;
    await notifyMember(row, body);
  }
  console.log(`Loan reminders processed: ${rows.length}`);
}

export function startLoanReminderJob() {
  // Every day at 8am server time
  cron.schedule('0 8 * * *', checkLoanDueDates);
}
