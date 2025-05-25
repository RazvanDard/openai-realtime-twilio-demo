import twilio from 'twilio';
import { OutboundCallRequest } from './types';
import { associateOutboundCallWithPhoneNumber } from './userSessionManager';

function validateEnvironmentVariables() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicUrl = process.env.PUBLIC_URL;

  if (!accountSid || !authToken || !publicUrl) {
    throw new Error('Missing required Twilio environment variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, PUBLIC_URL');
  }

  return { accountSid, authToken, publicUrl };
}

export async function initiateOutboundCall(request: OutboundCallRequest): Promise<string> {
  try {
    const { accountSid, authToken, publicUrl } = validateEnvironmentVariables();
    const client = twilio(accountSid, authToken);

    // Simple TwiML URL - no parameters needed!
    const twimlUrl = new URL(publicUrl);
    twimlUrl.pathname = `/twiml`;

    const call = await client.calls.create({
      to: request.phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER!,
      url: twimlUrl.toString(),
      method: 'POST',
    });

    // Associate the call SID with the user and start call history tracking
    associateOutboundCallWithPhoneNumber(request.userId, call.sid, request.phoneNumber);

    console.log(`Outbound call initiated for user ${request.userId}: ${call.sid}`);
    return call.sid;
  } catch (error) {
    console.error('Error initiating outbound call:', error);
    throw error;
  }
}

export function formatPhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  
  // If it doesn't start with +, add it
  if (!phoneNumber.startsWith('+')) {
    return '+' + digits;
  }
  
  return phoneNumber;
} 