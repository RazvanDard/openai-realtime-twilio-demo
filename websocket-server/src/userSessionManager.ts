import { RawData, WebSocket } from "ws";
import { UserSession } from "./types";
import { extractUserIdFromToken } from "./authMiddleware";
import functions from "./functionHandlers";
import { 
  startCallTracking, 
  updateCallStatus, 
  addConversationEvent, 
  endCallTracking 
} from "./callHistoryService";

// Map of userId to their session
const userSessions = new Map<string, UserSession>();

// Map of Twilio Call SID to userId for outbound calls
const callSidToUserId = new Map<string, string>();

export function getUserSession(userId: string): UserSession {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      userId,
    });
  }
  return userSessions.get(userId)!;
}

export function deleteUserSession(userId: string): void {
  const session = userSessions.get(userId);
  if (session) {
    cleanupConnection(session.twilioConn);
    cleanupConnection(session.frontendConn);
    cleanupConnection(session.modelConn);
    userSessions.delete(userId);
  }
}

export function handleCallConnection(ws: WebSocket, openAIApiKey: string) {
  console.log(`Call connection established - waiting for Call SID identification`);

  // We'll identify the user when we get the "start" event with Call SID
  ws.on("message", (data) => handleTwilioMessage(data, null, ws, openAIApiKey));
  ws.on("error", ws.close);
  ws.on("close", () => {
    console.log(`Anonymous call connection closed`);
  });
}

export function handleFrontendConnection(ws: WebSocket, token: string) {
  const userId = extractUserIdFromToken(token);
  if (!userId) {
    console.error('Invalid token for frontend connection');
    ws.close();
    return;
  }

  const session = getUserSession(userId);
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", (data) => handleFrontendMessage(data, userId));
  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
  });
}

export function associateOutboundCall(userId: string, callSid: string) {
  const session = getUserSession(userId);
  session.callType = 'outbound';
  session.outboundCallStatus = 'initiating';
  session.callSid = callSid;
  
  // Store the mapping for later lookup
  callSidToUserId.set(callSid, userId);
  console.log(`Associated Call SID ${callSid} with user ${userId}`);
}

export function associateOutboundCallWithPhoneNumber(userId: string, callSid: string, phoneNumber: string) {
  associateOutboundCall(userId, callSid);
  
  // Start call history tracking
  startCallTracking(callSid, userId, phoneNumber, 'outbound').catch(error => {
    console.error('Failed to start call tracking:', error);
  });
}

export function getUserIdByCallSid(callSid: string): string | undefined {
  return callSidToUserId.get(callSid);
}

async function handleFunctionCall(item: { name: string; arguments: string }, userId: string) {
  console.log("Handling function call for user:", userId, item);
  const fnDef = functions.find((f) => f.schema.name === item.name);
  if (!fnDef) {
    throw new Error(`No handler found for function: ${item.name}`);
  }

  let args: unknown;
  try {
    args = JSON.parse(item.arguments);
  } catch {
    return JSON.stringify({
      error: "Invalid JSON arguments for function call.",
    });
  }

  try {
    console.log("Calling function:", fnDef.schema.name, args);
    const result = await fnDef.handler(args as any);
    return result;
  } catch (err: any) {
    console.error("Error running function:", err);
    return JSON.stringify({
      error: `Error running function ${item.name}: ${err.message}`,
    });
  }
}

function handleTwilioMessage(data: RawData, userId: string | null, ws: WebSocket, openAIApiKey: string) {
  const msg = parseMessage(data);
  if (!msg) {
    console.log(`Failed to parse Twilio message:`, data.toString());
    return;
  }

  // Only log non-media events to reduce spam (media events happen 50+ times per second)
  if (msg.event !== "media") {
    console.log(`Twilio message:`, { event: msg.event, type: msg.type });
  }

  // If we don't have a userId yet, we need to get it from the start event
  if (!userId && msg.event === "start") {
    const callSid = msg.start.callSid;
    console.log(`Identifying user from Call SID: ${callSid}`);
    
    const foundUserId = getUserIdByCallSid(callSid);
    if (!foundUserId) {
      console.error(`No user found for Call SID ${callSid}`);
      ws.close();
      return;
    }
    
    userId = foundUserId;
    console.log(`Found user ${userId} for Call SID ${callSid}`);
    
    // Now properly set up the user session with this WebSocket
    const session = getUserSession(userId);
    cleanupConnection(session.twilioConn);
    session.twilioConn = ws;
    session.openAIApiKey = openAIApiKey;
    
    // Update call status for outbound calls
    if (session.callType === 'outbound') {
      session.outboundCallStatus = 'connected';
      updateCallStatus(callSid, 'connected').catch(error => {
        console.error('Failed to update call status to connected:', error);
      });
    }
    
    console.log(`Call connection established for user ${userId} (callType: ${session.callType})`);
    
    // Update the message handler to use the correct userId
    ws.removeAllListeners('message');
    ws.on("message", (data) => handleTwilioMessage(data, userId, ws, openAIApiKey));
    ws.on("error", ws.close);
    ws.on("close", () => {
      console.log(`Call connection closed for user ${userId}`);
      
      // End call tracking
      if (session.callSid) {
        endCallTracking(session.callSid).catch(error => {
          console.error('Failed to end call tracking:', error);
        });
      }
      
      cleanupConnection(session.modelConn);
      cleanupConnection(session.twilioConn);
      session.twilioConn = undefined;
      session.modelConn = undefined;
      session.streamSid = undefined;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      session.latestMediaTimestamp = undefined;
      if (session.callType === 'outbound') {
        session.outboundCallStatus = 'disconnected';
      }
    });
  }

  // If we still don't have a userId, something is wrong
  if (!userId) {
    console.error('No userId available for message processing');
    return;
  }

  const session = getUserSession(userId);

  switch (msg.event) {
    case "start":
      console.log(`Twilio stream started for user ${userId}:`, msg.start);
      session.streamSid = msg.start.streamSid;
      session.latestMediaTimestamp = 0;
      session.lastAssistantItem = undefined;
      session.responseStartTimestamp = undefined;
      
      if (!session.callType) {
        session.callType = 'inbound';
        // For inbound calls, start tracking here since we didn't have the phone number before
        if (msg.start.callSid) {
          // Extract phone number from the start event if available
          const phoneNumber = msg.start.from || 'unknown';
          startCallTracking(msg.start.callSid, userId, phoneNumber, 'inbound').catch(error => {
            console.error('Failed to start inbound call tracking:', error);
          });
          session.callSid = msg.start.callSid;
        }
      }
      
      console.log(`Calling tryConnectModel for user ${userId} after stream start`);
      tryConnectModel(userId);
      break;
      
    case "media":
      // Only log every 1000th media message to avoid spam (was causing the excessive logging)
      if (msg.media.timestamp % 100000 === 0) {
        console.log(`Twilio media message for user ${userId}:`, { timestamp: msg.media.timestamp });
      }
      session.latestMediaTimestamp = msg.media.timestamp;
      if (isOpen(session.modelConn)) {
        jsonSend(session.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
      } else {
        console.log(`Model connection not open for user ${userId}, cannot send audio`);
      }
      break;
      
    case "close":
      console.log(`Twilio stream closed for user ${userId}`);
      
      // End call tracking
      if (session.callSid) {
        endCallTracking(session.callSid).catch(error => {
          console.error('Failed to end call tracking:', error);
        });
      }
      
      cleanupConnection(session.twilioConn);
      cleanupConnection(session.modelConn);
      session.twilioConn = undefined;
      session.modelConn = undefined;
      session.outboundCallStatus = 'disconnected';
      break;
      
    case "stop":
      console.log(`Twilio stream stopped for user ${userId}`);
      // End call tracking on stop event too
      if (session.callSid) {
        endCallTracking(session.callSid).catch(error => {
          console.error('Failed to end call tracking:', error);
        });
      }
      break;
      
    default:
      console.log(`Unknown Twilio event for user ${userId}:`, msg.event);
      break;
  }
}

function handleFrontendMessage(data: RawData, userId: string) {
  const session = getUserSession(userId);
  const msg = parseMessage(data);
  if (!msg) return;

  if (isOpen(session.modelConn)) {
    jsonSend(session.modelConn, msg);
  }

  if (msg.type === "session.update") {
    session.saved_config = msg.session;
  }
}

function tryConnectModel(userId: string) {
  const session = getUserSession(userId);
  
  console.log(`tryConnectModel for user ${userId}:`, {
    hasTwilioConn: !!session.twilioConn,
    hasStreamSid: !!session.streamSid,
    hasOpenAIApiKey: !!session.openAIApiKey,
    hasModelConn: !!session.modelConn,
    isModelConnOpen: isOpen(session.modelConn)
  });
  
  if (!session.twilioConn || !session.streamSid || !session.openAIApiKey) {
    console.error(`Cannot connect to OpenAI model for user ${userId}:`, {
      twilioConn: !!session.twilioConn,
      streamSid: !!session.streamSid, 
      openAIApiKey: !!session.openAIApiKey
    });
    return;
  }
  if (isOpen(session.modelConn)) {
    console.log(`Model connection already open for user ${userId}`);
    return;
  }

  console.log(`Connecting to OpenAI Realtime API for user ${userId}...`);

  session.modelConn = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${session.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  session.modelConn.on("open", () => {
    console.log(`OpenAI model connection opened for user ${userId}`);
    const config = session.saved_config || {};
    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        turn_detection: { type: "server_vad" },
        voice: "ash",
        input_audio_transcription: { model: "whisper-1" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        ...config,
      },
    };
    console.log(`Sending session config for user ${userId}:`, sessionConfig);
    jsonSend(session.modelConn, sessionConfig);
  });

  session.modelConn.on("message", (data) => handleModelMessage(data, userId));
  session.modelConn.on("error", (error) => {
    console.error(`OpenAI model connection error for user ${userId}:`, error);
    closeModel(userId);
  });
  session.modelConn.on("close", (code, reason) => {
    console.log(`OpenAI model connection closed for user ${userId}:`, { code, reason: reason.toString() });
    closeModel(userId);
  });
}

function handleModelMessage(data: RawData, userId: string) {
  const session = getUserSession(userId);
  const event = parseMessage(data);
  if (!event) return;

  jsonSend(session.frontendConn, event);

  switch (event.type) {
    case "input_audio_buffer.speech_started":

      setTimeout(() => {
        handleTruncation(userId);
      }, 200); // 800ms delay to let assistant finish current sentence
      
      // Track user speech event
      if (session.callSid) {
        addConversationEvent(
          session.callSid,
          'user_speech',
          'user',
          'Speech started'
        ).catch(error => {
          console.error('Failed to track user speech start:', error);
        });
      }
      break;

    case "conversation.item.input_audio_transcription.completed":
      // Track user speech transcription
      if (session.callSid && event.transcript) {
        addConversationEvent(
          session.callSid,
          'user_speech',
          'user',
          event.transcript,
          {
            transcription_confidence: event.confidence
          }
        ).catch(error => {
          console.error('Failed to track user speech transcription:', error);
        });
      }
      break;

    case "response.audio.delta":
      if (session.twilioConn && session.streamSid) {
        if (session.responseStartTimestamp === undefined) {
          session.responseStartTimestamp = session.latestMediaTimestamp || 0;
        }
        if (event.item_id) session.lastAssistantItem = event.item_id;

        jsonSend(session.twilioConn, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: event.delta },
        });

        jsonSend(session.twilioConn, {
          event: "mark",
          streamSid: session.streamSid,
        });
      }
      break;

    case "response.audio_transcript.delta":
      // Track assistant speech (accumulate deltas for cleaner logging)
      if (session.callSid && event.delta) {
        // Use a simple approach - track significant deltas
        if (event.delta.length > 5) {
          addConversationEvent(
            session.callSid,
            'assistant_speech',
            'assistant',
            event.delta
          ).catch(error => {
            console.error('Failed to track assistant speech:', error);
          });
        }
      }
      break;

    case "response.output_item.done": {
      const { item } = event;
      
      if (item.type === "message" && item.content) {
        // Track complete assistant message
        const textContent = item.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join(' ');
          
        if (session.callSid && textContent) {
          addConversationEvent(
            session.callSid,
            'assistant_speech',
            'assistant',
            textContent
          ).catch(error => {
            console.error('Failed to track assistant message:', error);
          });
        }
      }
      
      if (item.type === "function_call") {
        // Track function call
        if (session.callSid) {
          addConversationEvent(
            session.callSid,
            'function_call',
            'system',
            `Function: ${item.name}`,
            {
              function_name: item.name,
              function_args: item.arguments
            }
          ).catch(error => {
            console.error('Failed to track function call:', error);
          });
        }
        
        handleFunctionCall(item, userId)
          .then((output) => {
            const currentSession = getUserSession(userId);
            
            // Track function result
            if (currentSession.callSid) {
              addConversationEvent(
                currentSession.callSid,
                'function_call',
                'system',
                `Result: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`,
                {
                  function_name: item.name,
                  function_result: output
                }
              ).catch(error => {
                console.error('Failed to track function result:', error);
              });
            }
            
            if (currentSession.modelConn) {
              jsonSend(currentSession.modelConn, {
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: item.call_id,
                  output: JSON.stringify(output),
                },
              });
              jsonSend(currentSession.modelConn, { type: "response.create" });
            }
          })
          .catch((error) => {
            console.error("Function call error:", error);
            
            // Track function error
            if (session.callSid) {
              addConversationEvent(
                session.callSid,
                'system_event',
                'system',
                `Function error: ${error.message}`,
                {
                  function_name: item.name,
                  function_result: error.message
                }
              ).catch(trackError => {
                console.error('Failed to track function error:', trackError);
              });
            }
          });
      }
      break;
    }
  }
}

function handleTruncation(userId: string) {
  const session = getUserSession(userId);
  
  if (!session.lastAssistantItem) {
    console.log("No assistant item to truncate for user:", userId);
    return;
  }

  if (!session.responseStartTimestamp) {
    console.log("No response start timestamp for user:", userId);
    return;
  }

  const elapsedMs = (session.latestMediaTimestamp || 0) - session.responseStartTimestamp;
  const elapsedSamples = Math.floor((elapsedMs / 1000) * 8000);

  // Truncate the assistant's current audio
  jsonSend(session.modelConn, {
    type: "conversation.item.truncate",
    item_id: session.lastAssistantItem,
    content_index: 0,
    audio_end_ms: elapsedMs,
  });

  // Clear the input buffer
  jsonSend(session.modelConn, {
    type: "input_audio_buffer.clear",
  });

  // Add a system message to let the AI know it was interrupted
  jsonSend(session.modelConn, {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "system",
      content: [
        {
          type: "text",
          text: "You were just interrupted by the user while speaking. The user is now talking. Listen to what they're saying and respond appropriately."
        }
      ]
    }
  });

  // Track the interruption event
  if (session.callSid) {
    addConversationEvent(
      session.callSid,
      'system_event',
      'system',
      'Assistant was interrupted by user',
      {
        elapsed_ms: elapsedMs,
        truncated_item_id: session.lastAssistantItem
      } as any
    ).catch(error => {
      console.error('Failed to track interruption event:', error);
    });
  }

  // Reset the assistant tracking
  session.lastAssistantItem = undefined;
  session.responseStartTimestamp = undefined;
}

function closeModel(userId: string) {
  const session = getUserSession(userId);
  cleanupConnection(session.modelConn);
  session.modelConn = undefined;
}

function cleanupConnection(ws?: WebSocket) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
  }
}

function parseMessage(data: RawData): any {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function jsonSend(ws: WebSocket | undefined, obj: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function isOpen(ws?: WebSocket): ws is WebSocket {
  return ws !== undefined && ws.readyState === WebSocket.OPEN;
} 