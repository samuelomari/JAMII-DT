// M-Pesa Daraja: STK push + callback ingestion with auto-matching.
import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../db/pool';
import { repayLoan } from '../loans/repayLoan';
import { savingsTransaction } from '../savings/savings';

export const mpesaOk = (extra = {}) => ({ ResultCode: 0, ResultDesc: 'Accepted', ...extra });

function stkPassword(s: string, p: string, t: string): string {
  return Buffer.from(s + p + t).toString('base64');
}

function darajaTimestamp(d = new Date()): string {
  const q = (n: number) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + q(d.getMonth() + 1) + q(d.getDate()) + q(d.getHours()) + q(d.getMinutes()) + q(d.getSeconds());
}

function darajaHost(): string {
  return (process.env.MPESA_ENV ?? 'sandbox').toLowerCase() === 'production' ? 'api.safaricom.co.ke' : 'sandbox.safaricom.co.ke';
}

async function darajaToken(): Promise<string> {
  const key = process.env.MPESA_CONSUMER_KEY ?? '';
  const secret = process.env.MPESA_CONSUMER_SECRET ?? '';
  if (!key || !secret) throw new Error('MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET not configured');
  const res = await fetch('https://' + darajaHost() + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64') },
  });
  if (!res.ok) throw new Error('Daraja token request failed: ' + res.status);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Daraja token missing in response');
  return data.access_token;
}

function normalizePhone(raw: string): string {
  let phone = raw.replace(/\s+/g, '');
  if (/^0/.test(phone)) phone = '254' + phone.slice(1);
  if (/^\+/.test(phone)) phone = phone.slice(1);
  return phone;
}

export async function stkPush(input: { memberId: number; amount: number; phone?: string; accountRef?: string; description?: string }) {
  const amount = Math.round(Number(input.amount));
  if (!input.memberId || !(amount > 0)) throw new Error('memberId and positive amount are required');
  const shortcode = process.env.MPESA_SHORTCODE ?? '';
  const passkey = process.env.MPESA_PASSKEY ?? '';
  if (!shortcode || !passkey) throw new Error('MPESA_SHORTCODE/MPESA_PASSKEY not configured');
  if (!process.env.MPESA_CALLBACK_URL) throw new Error('MPESA_CALLBACK_URL not configured');
  const { rows } = await pool.query('SELECT * FROM members WHERE id=$1', [input.memberId]);
  const member = rows[0];
  if (!member) throw new Error('Member ' + input.memberId + ' not found');
  const phone = normalizePhone(input.phone ?? member.phone);
  const timestamp = darajaTimestamp();
  const token = await darajaToken();
  const res = await fetch('https://' + darajaHost() + '/mpesa/stkpush/v1/processrequest', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: input.accountRef ?? ('JAMII-' + member.id),
      TransactionDesc: input.description ?? 'Sacco payment',
    }),
  });
  const data = await res.json().catch(() => ({} as any));
  await pool.query(
    'INSERT INTO mpesa_callbacks (checkout_request_id, merchant_request_id, result_code, result_desc, raw) ' +
    'VALUES ($1,$2,$3,$4,$5) ON CONFLICT (checkout_request_id) DO NOTHING',
    [data.CheckoutRequestID ?? randomUUID(), data.MerchantRequestID ?? null,
     data.ResponseCode !== undefined ? Number(data.ResponseCode) : null,
     data.ResponseDescription ?? null, JSON.stringify({ memberId: member.id, amount, phone, data })]
  );
  if (!res.ok || String(data.ResponseCode ?? '') !== '0') {
    throw new Error('STK push failed: ' + (data.ResponseDescription ?? res.status));
  }
  return { memberId: member.id, amount, phone, checkoutRequestId: data.CheckoutRequestID, merchantRequestId: data.MerchantRequestID };
}

interface CbMeta { TransID?: string; TransAmount?: string; BillRefNumber?: string; MSISDN?: string; }

function parseCb(body: any) {
  const cb = body?.Body?.stkCallback ?? {};
  const items: any[] = cb.CallbackMetadata?.Item ?? [];
  const meta: CbMeta = {};
  for (const it of items) if (it?.Name) (meta as any)[it.Name] = it.Value;
  return { checkoutId: cb.CheckoutRequestID ?? null, resultCode: cb.ResultCode ?? null, resultDesc: cb.ResultDesc ?? null, meta };
}

function variants(msisdn: string): string[] {
  const digits = msisdn.replace(/\D/g, '');
  const out = new Set<string>([msisdn, digits, '+' + digits]);
  if (digits.startsWith('254')) out.add('0' + digits.slice(3));
  if (digits.startsWith('0')) out.add('254' + digits.slice(1));
  return [...out];
}

async function findMember(phones: string[], billRef?: string) {
  if (billRef) {
    const m = billRef.match(/JAMII-(\d+)/i);
    if (m) {
      const r = await pool.query('SELECT * FROM members WHERE id=$1', [Number(m[1])]);
      if (r.rows[0]) return r.rows[0];
    }
  }
  for (const p of phones) {
    const r = await pool.query('SELECT * FROM members WHERE phone=$1 LIMIT 1', [p]);
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

function rHash(ref: string, amt: number, phone: string): string {
  return createHash('sha256').update(ref + '|' + amt + '|' + phone).digest('hex').slice(0, 32);
}

// Idempotent: same TransID twice returns the first outcome.
export async function handleStkCallback(body: any) {
  const parsed = parseCb(body);
  const checkoutId = parsed.checkoutId as string | null;
  const resultCode = parsed.resultCode as number | null;
  const resultDesc = parsed.resultDesc as string | null;
  const meta = parsed.meta;
  const reference = meta.TransID ?? checkoutId ?? ('STK-' + Date.now());
  const amount = Number(meta.TransAmount ?? 0);
  const phone = String(meta.MSISDN ?? '');
  const billRef = meta.BillRefNumber ? String(meta.BillRefNumber) : undefined;
  if (resultCode !== 0) {
    await pool.query(
      'INSERT INTO mpesa_callbacks (checkout_request_id, result_code, result_desc, receipt, amount, phone, raw) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (checkout_request_id) ' +
      'DO UPDATE SET result_code=EXCLUDED.result_code, result_desc=EXCLUDED.result_desc, raw=EXCLUDED.raw',
      [checkoutId ?? reference, resultCode, resultDesc, reference, Number.isFinite(amount) ? amount : null, phone || null, JSON.stringify(body)]
    );
    return { ...mpesaOk(), matched: false, reason: resultDesc ?? 'Payment failed or cancelled' };
  }
  const hash = rHash(reference, amount, phone);
  const dup = await pool.query('SELECT * FROM mpesa_callbacks WHERE receipt_hash=$1 LIMIT 1', [hash]);
  if (dup.rows[0]?.processed && dup.rows[0]?.matched_member_id) {
    return { ...mpesaOk(), matched: true, duplicate: true, outcome: dup.rows[0].outcome, memberId: dup.rows[0].matched_member_id };
  }
  const member = await findMember(variants(phone), billRef);
  if (!member || !(amount > 0)) {
    await pool.query(
      'INSERT INTO mpesa_callbacks (checkout_request_id, result_code, result_desc, receipt, amount, phone, raw, receipt_hash, processed, outcome) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT (checkout_request_id) ' +
      'DO UPDATE SET processed=true, outcome=EXCLUDED.outcome, raw=EXCLUDED.raw',
      [checkoutId ?? reference, resultCode, resultDesc, reference, amount || null, phone || null,
       JSON.stringify(body), hash, member ? 'Invalid amount' : ('No member for ' + phone)]
    );
    return { ...mpesaOk(), matched: false, reason: 'Member not found - flagged for review' };
  }
  let outcome = '';
  let loanId: number | null = null;
  try {
    const loans = await pool.query(
      'SELECT * FROM loans WHERE member_id=$1 AND status IN (' + "'active','arrears'" + ') ORDER BY due_date ASC, id ASC LIMIT 1', [member.id]);
    if (loans.rows[0]) {
      loanId = loans.rows[0].id;
      const res = await repayLoan({ loanId: loans.rows[0].id, amount, method: 'M-Pesa', reference });
      outcome = 'Applied KSh ' + amount + ' to loan #' + loans.rows[0].id + ' (balance KSh ' + res.balance + ')';
    } else {
      await savingsTransaction(member.id, 'deposit', amount, reference);
      outcome = 'Credited KSh ' + amount + ' to savings (no open loan)';
    }
  } catch (e: any) { outcome = 'Match failed: ' + e.message; }
  await pool.query(
    'INSERT INTO mpesa_callbacks (checkout_request_id, result_code, result_desc, receipt, amount, phone, raw, ' +
    'receipt_hash, processed, matched_member_id, matched_loan_id, outcome) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11) ' +
    'ON CONFLICT (checkout_request_id) DO UPDATE SET processed=true, matched_member_id=EXCLUDED.matched_member_id, ' +
    'matched_loan_id=EXCLUDED.matched_loan_id, outcome=EXCLUDED.outcome, raw=EXCLUDED.raw',
    [checkoutId ?? reference, resultCode, resultDesc, reference, amount, phone, JSON.stringify(body), hash, member.id, loanId, outcome]
  );
  return { ...mpesaOk(), matched: true, memberId: member.id, reference, amount, outcome };
}

export async function listMpesaCallbacks(limit = 100) {
  const { rows } = await pool.query('SELECT * FROM mpesa_callbacks ORDER BY received_at DESC LIMIT $1', [limit]);
  return rows;
}

