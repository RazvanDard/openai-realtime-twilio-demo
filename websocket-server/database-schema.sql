-- Call History Database Schema for Supabase
-- Run this in your Supabase SQL editor to create the required tables

-- Drop existing tables if they exist (in case of conflicts from other projects)
DROP TABLE IF EXISTS conversation_events CASCADE;
DROP TABLE IF EXISTS call_records CASCADE;
DROP VIEW IF EXISTS call_history_summary CASCADE;

-- Table to store call records
CREATE TABLE call_records (
  id BIGSERIAL PRIMARY KEY,
  call_sid VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('initiating', 'connected', 'completed', 'failed', 'disconnected')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration INTEGER, -- in seconds
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table to store conversation events during calls
CREATE TABLE conversation_events (
  id BIGSERIAL PRIMARY KEY,
  call_sid VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('user_speech', 'assistant_speech', 'function_call', 'system_event')),
  speaker VARCHAR(20) NOT NULL CHECK (speaker IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_conversation_events_call_sid 
    FOREIGN KEY (call_sid) REFERENCES call_records(call_sid) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX idx_call_records_user_id ON call_records(user_id);
CREATE INDEX idx_call_records_phone_number ON call_records(phone_number);
CREATE INDEX idx_call_records_start_time ON call_records(start_time DESC);
CREATE INDEX idx_call_records_call_sid ON call_records(call_sid);

CREATE INDEX idx_conversation_events_call_sid ON conversation_events(call_sid);
CREATE INDEX idx_conversation_events_timestamp ON conversation_events(timestamp DESC);
CREATE INDEX idx_conversation_events_event_type ON conversation_events(event_type);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_call_records_updated_at BEFORE UPDATE ON call_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE call_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own call records
CREATE POLICY "Users can view own call records" ON call_records
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own call records" ON call_records
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own call records" ON call_records
    FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can only see conversation events for their own calls
CREATE POLICY "Users can view own conversation events" ON conversation_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM call_records 
            WHERE call_records.call_sid = conversation_events.call_sid 
            AND call_records.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert conversation events for own calls" ON conversation_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM call_records 
            WHERE call_records.call_sid = conversation_events.call_sid 
            AND call_records.user_id = auth.uid()
        )
    );

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON call_records TO authenticated;
GRANT SELECT, INSERT ON conversation_events TO authenticated;
GRANT USAGE ON SEQUENCE call_records_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE conversation_events_id_seq TO authenticated;

-- Create a view for call history with conversation counts
-- Views inherit security from underlying tables, so no need for separate RLS policy
CREATE VIEW call_history_summary AS
SELECT 
    cr.id,
    cr.call_sid,
    cr.user_id,
    cr.phone_number,
    cr.direction,
    cr.status,
    cr.start_time,
    cr.end_time,
    cr.duration,
    cr.created_at,
    cr.updated_at,
    COUNT(ce.id) as conversation_event_count,
    COUNT(CASE WHEN ce.event_type = 'user_speech' THEN 1 END) as user_messages,
    COUNT(CASE WHEN ce.event_type = 'assistant_speech' THEN 1 END) as assistant_messages,
    COUNT(CASE WHEN ce.event_type = 'function_call' THEN 1 END) as function_calls
FROM call_records cr
LEFT JOIN conversation_events ce ON cr.call_sid = ce.call_sid
GROUP BY cr.id, cr.call_sid, cr.user_id, cr.phone_number, cr.direction, 
         cr.status, cr.start_time, cr.end_time, cr.duration, cr.created_at, cr.updated_at;

-- Grant access to the view
GRANT SELECT ON call_history_summary TO authenticated; 