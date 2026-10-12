export interface AlertMessage {
  to: string;
  body: string;
}

export interface SendResult {
  success: boolean;
  providerId?: string;
}

export interface Channel {
  name: string;
  send(message: AlertMessage): Promise<SendResult>;
}
