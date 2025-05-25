import { CallRecord, ConversationEvent, CallHistoryQuery, CallHistoryResponse, CallHistoryStats } from './types';
import supabase from './supabase';

/**
 * Start tracking a new call in the database
 */
export async function startCallTracking(
  callSid: string, 
  userId: string, 
  phoneNumber: string, 
  direction: 'inbound' | 'outbound'
): Promise<void> {
  try {
    const callRecord: Omit<CallRecord, 'id' | 'created_at' | 'updated_at'> = {
      call_sid: callSid,
      user_id: userId,
      phone_number: phoneNumber,
      direction,
      status: 'initiating',
      start_time: new Date().toISOString()
    };

    const { error } = await supabase
      .from('call_records')
      .insert([callRecord]);

    if (error) {
      console.error('Error starting call tracking:', error);
      throw error;
    }

    console.log(`Started tracking call ${callSid} for user ${userId} (${direction} to/from ${phoneNumber})`);
  } catch (error) {
    console.error('Failed to start call tracking:', error);
    throw error;
  }
}

/**
 * Update call status in the database
 */
export async function updateCallStatus(callSid: string, status: CallRecord['status']): Promise<void> {
  try {
    const updateData: Partial<CallRecord> = { status };
    
    if (status === 'connected') {
      // Update start time to when actually connected
      updateData.start_time = new Date().toISOString();
    }

    const { error } = await supabase
      .from('call_records')
      .update(updateData)
      .eq('call_sid', callSid);

    if (error) {
      console.error('Error updating call status:', error);
      throw error;
    }

    console.log(`Updated call ${callSid} status to ${status}`);
  } catch (error) {
    console.error('Failed to update call status:', error);
    throw error;
  }
}

/**
 * Add a conversation event to the database
 */
export async function addConversationEvent(
  callSid: string, 
  eventType: ConversationEvent['event_type'],
  speaker: ConversationEvent['speaker'],
  content: string,
  metadata?: ConversationEvent['metadata']
): Promise<void> {
  try {
    const event: Omit<ConversationEvent, 'id' | 'created_at'> = {
      call_sid: callSid,
      timestamp: new Date().toISOString(),
      event_type: eventType,
      speaker,
      content,
      metadata
    };

    const { error } = await supabase
      .from('conversation_events')
      .insert([event]);

    if (error) {
      console.error('Error adding conversation event:', error);
      throw error;
    }

    // Log significant events (not every audio chunk)
    if (eventType !== 'assistant_speech' || Math.random() < 0.1) {
      console.log(`Added ${eventType} event to call ${callSid}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
    }
  } catch (error) {
    console.error('Failed to add conversation event:', error);
    // Don't throw here to avoid disrupting call flow
  }
}

/**
 * End call tracking and finalize the record
 */
export async function endCallTracking(callSid: string): Promise<void> {
  try {
    const endTime = new Date().toISOString();
    
    // Get the current call record to calculate duration
    const { data: callRecord, error: fetchError } = await supabase
      .from('call_records')
      .select('start_time')
      .eq('call_sid', callSid)
      .single();

    if (fetchError) {
      console.error('Error fetching call record for end tracking:', fetchError);
      return;
    }

    if (!callRecord) {
      console.warn(`No call record found for call ${callSid}`);
      return;
    }

    // Calculate duration
    const startTime = new Date(callRecord.start_time);
    const duration = Math.floor((new Date(endTime).getTime() - startTime.getTime()) / 1000);

    const { error } = await supabase
      .from('call_records')
      .update({
        end_time: endTime,
        duration,
        status: 'completed'
      })
      .eq('call_sid', callSid);

    if (error) {
      console.error('Error ending call tracking:', error);
      throw error;
    }

    console.log(`Ended tracking for call ${callSid} - Duration: ${duration}s`);
  } catch (error) {
    console.error('Failed to end call tracking:', error);
    throw error;
  }
}

/**
 * Get call history for a user with optional filtering
 */
export async function getCallHistory(query: CallHistoryQuery): Promise<CallHistoryResponse> {
  try {
    let supabaseQuery = supabase
      .from('call_records')
      .select(`
        *,
        conversation_events (*)
      `)
      .eq('user_id', query.userId)
      .order('start_time', { ascending: false });

    // Apply filters
    if (query.phoneNumber) {
      const cleanNumber = query.phoneNumber.replace(/\D/g, '');
      supabaseQuery = supabaseQuery.or(`phone_number.ilike.%${query.phoneNumber}%,phone_number.ilike.%${cleanNumber}%`);
    }

    if (query.startDate) {
      supabaseQuery = supabaseQuery.gte('start_time', query.startDate.toISOString());
    }

    if (query.endDate) {
      supabaseQuery = supabaseQuery.lte('start_time', query.endDate.toISOString());
    }

    // Get total count first
    const { count, error: countError } = await supabase
      .from('call_records')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', query.userId);

    if (countError) {
      throw countError;
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    
    supabaseQuery = supabaseQuery.range(offset, offset + limit - 1);

    const { data, error } = await supabaseQuery;

    if (error) {
      throw error;
    }

    const total = count || 0;
    
    return {
      calls: data || [],
      total,
      hasMore: offset + limit < total
    };
  } catch (error) {
    console.error('Failed to get call history:', error);
    throw error;
  }
}

/**
 * Get a specific call by Call SID
 */
export async function getCallBySid(callSid: string): Promise<(CallRecord & { conversation_events?: ConversationEvent[] }) | null> {
  try {
    const { data, error } = await supabase
      .from('call_records')
      .select(`
        *,
        conversation_events (*)
      `)
      .eq('call_sid', callSid)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to get call by SID:', error);
    throw error;
  }
}

/**
 * Get summary statistics for a user's call history
 */
export async function getCallHistoryStats(userId: string): Promise<CallHistoryStats> {
  try {
    const { data, error } = await supabase
      .from('call_records')
      .select('phone_number, direction, duration')
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    const calls = data || [];
    const completedCalls = calls.filter(call => call.duration !== null && call.duration !== undefined);
    const totalDuration = completedCalls.reduce((sum, call) => sum + (call.duration || 0), 0);
    const phoneNumbers = new Set(calls.map(call => call.phone_number));

    return {
      totalCalls: calls.length,
      totalDuration,
      avgDuration: completedCalls.length > 0 ? Math.round(totalDuration / completedCalls.length) : 0,
      inboundCalls: calls.filter(call => call.direction === 'inbound').length,
      outboundCalls: calls.filter(call => call.direction === 'outbound').length,
      uniqueNumbers: phoneNumbers.size
    };
  } catch (error) {
    console.error('Failed to get call history stats:', error);
    throw error;
  }
}

/**
 * Initialize database tables (for development/testing)
 */
export async function initializeDatabase(): Promise<void> {
  console.log('Note: Database tables should be created through Supabase dashboard or migration scripts.');
  console.log('Required tables: call_records, conversation_events');
}

/**
 * Get recent calls for a phone number (for inbound call context)
 */
export async function getRecentCallsForNumber(phoneNumber: string, limit: number = 5): Promise<CallRecord[]> {
  try {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    const { data, error } = await supabase
      .from('call_records')
      .select('*')
      .or(`phone_number.ilike.%${phoneNumber}%,phone_number.ilike.%${cleanNumber}%`)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Failed to get recent calls for number:', error);
    return [];
  }
} 