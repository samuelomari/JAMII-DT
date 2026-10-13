// Africa's Talking ships no TypeScript types, and an ambient `declare module`
// is fragile (ts-node-dev does not load .d.ts files from `include`). Instead we
// load the CommonJS export through `require` and expose only the slice we use.

export interface SmsSendOptions {
  to: string[];
  message: string;
  from?: string;
}

export interface SmsService {
  send(options: SmsSendOptions): Promise<unknown>;
}

export interface AfricasTalkingClient {
  SMS: SmsService;
}

export interface AfricasTalkingCredentials {
  apiKey: string;
  username: string;
}

type AfricasTalkingFactory = (credentials: AfricasTalkingCredentials) => AfricasTalkingClient;

const loadFactory = (): AfricasTalkingFactory =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('africastalking') as AfricasTalkingFactory;

export function africasTalkingClient(credentials: AfricasTalkingCredentials): AfricasTalkingClient {
  if (!credentials.apiKey || !credentials.username) {
    throw new Error('Africa\'s Talking credentials are not configured (AT_API_KEY, AT_USERNAME)');
  }
  return loadFactory()(credentials);
}
