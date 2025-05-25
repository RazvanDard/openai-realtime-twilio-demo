import { WebSocket } from "ws";

export interface UserSession {
  userId: string;
  sessionId?: string;
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
  callType?: 'inbound' | 'outbound';
  callSid?: string;
  outboundCallStatus?: 'initiating' | 'ringing' | 'connected' | 'disconnected';
}

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  config?: any;
  streamSid?: string;
}

export interface FunctionCallItem {
  name: string;
  arguments: string;
  call_id?: string;
}

export interface FunctionSchema {
  name: string;
  type: "function";
  description?: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export interface FunctionHandler {
  schema: FunctionSchema;
  handler: (args: any) => Promise<string>;
}

export interface OutboundCallRequest {
  phoneNumber: string;
  userId: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
}

export interface CallRecord {
  id?: number;
  call_sid: string;
  user_id: string;
  phone_number: string;
  direction: 'inbound' | 'outbound';
  status: 'initiating' | 'connected' | 'completed' | 'failed' | 'disconnected';
  start_time: string; // ISO timestamp
  end_time?: string; // ISO timestamp
  duration?: number; // in seconds
  created_at?: string;
  updated_at?: string;
}

export interface ConversationEvent {
  id?: number;
  call_sid: string;
  timestamp: string; // ISO timestamp
  event_type: 'user_speech' | 'assistant_speech' | 'function_call' | 'system_event';
  speaker: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    function_name?: string;
    function_args?: any;
    function_result?: any;
    transcription_confidence?: number;
    audio_delay_ms?: number;
  };
  created_at?: string;
}

export interface CallHistoryQuery {
  userId: string;
  phoneNumber?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface CallHistoryResponse {
  calls: (CallRecord & { conversation_events?: ConversationEvent[] })[];
  total: number;
  hasMore: boolean;
}

export interface CallHistoryStats {
  totalCalls: number;
  totalDuration: number;
  avgDuration: number;
  inboundCalls: number;
  outboundCalls: number;
  uniqueNumbers: number;
}
