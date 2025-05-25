"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from './auth-provider';
import { supabase } from '@/lib/supabase';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, User, Calendar, Search, MessageSquare, X, Bot } from 'lucide-react';

interface CallRecord {
  id: number;
  call_sid: string;
  user_id: string;
  phone_number: string;
  direction: 'inbound' | 'outbound';
  status: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  conversation_events?: ConversationEvent[];
}

interface ConversationEvent {
  id: number;
  timestamp: string;
  event_type: 'user_speech' | 'assistant_speech' | 'function_call' | 'system_event';
  speaker: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: any;
}

interface CallHistoryStats {
  totalCalls: number;
  totalDuration: number;
  avgDuration: number;
  inboundCalls: number;
  outboundCalls: number;
  uniqueNumbers: number;
}

export default function CallHistoryPanel() {
  console.log('CallHistoryPanel rendering...'); // Debug log
  
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<CallHistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [showConversation, setShowConversation] = useState(false);
  const { user } = useAuth();

  console.log('CallHistoryPanel - user:', user); // Debug log
  
  useEffect(() => {
    if (user) {
      console.log('User found, fetching call history...'); // Debug log
      fetchCallHistory();
      fetchCallStats();
    } else {
      console.log('No user found, setting loading to false'); // Debug log
      setLoading(false);
    }
  }, [user]);

  const fetchCallHistory = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch('http://localhost:8081/call-history?limit=50', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch call history');
      
      const result = await response.json();
      setCalls(result.calls || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCallStats = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch('http://localhost:8081/call-history/stats', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const statsData = await response.json();
        setStats(statsData);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchCallDetails = async (callSid: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const response = await fetch(`http://localhost:8081/call-history/${callSid}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch call details');
      
      const callDetails = await response.json();
      setSelectedCall(callDetails);
      setShowConversation(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const filteredCalls = calls.filter(call =>
    call.phone_number.includes(searchTerm) ||
    call.phone_number.replace(/\D/g, '').includes(searchTerm.replace(/\D/g, ''))
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center">
            <Phone className="w-5 h-5 mr-2" />
            Call History
          </h2>
          {stats && (
            <div className="text-sm text-gray-600">
              {stats.totalCalls} calls • {Math.floor(stats.totalDuration / 60)}m total
            </div>
          )}
        </div>

        {/* Stats Summary */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-blue-600">{stats.totalCalls}</div>
              <div className="text-xs text-blue-500">Total Calls</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-green-600">{stats.outboundCalls}</div>
              <div className="text-xs text-green-500">Outbound</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-purple-600">{stats.uniqueNumbers}</div>
              <div className="text-xs text-purple-500">Unique Numbers</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-orange-600">{formatDuration(stats.avgDuration)}</div>
              <div className="text-xs text-orange-500">Avg Duration</div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search by phone number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Call List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredCalls.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchTerm ? 'No calls found matching your search.' : 'No call history yet. Make your first call!'}
            </div>
          ) : (
            filteredCalls.map((call) => (
              <div
                key={call.id}
                onClick={() => fetchCallDetails(call.call_sid)}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    call.direction === 'outbound' 
                      ? 'bg-green-100 text-green-600' 
                      : 'bg-blue-100 text-blue-600'
                  }`}>
                    {call.direction === 'outbound' ? (
                      <PhoneOutgoing className="w-4 h-4" />
                    ) : (
                      <PhoneIncoming className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{call.phone_number}</div>
                    <div className="text-sm text-gray-500 flex items-center">
                      <Calendar className="w-3 h-3 mr-1" />
                      {formatDate(call.start_time)}
                      {call.duration && (
                        <>
                          <Clock className="w-3 h-3 ml-3 mr-1" />
                          {formatDuration(call.duration)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    call.status === 'completed' 
                      ? 'bg-green-100 text-green-700'
                      : call.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {call.status}
                  </span>
                  <MessageSquare className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Conversation Modal */}
      {showConversation && selectedCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">
                Call with {selectedCall.phone_number}
              </h3>
              <button
                onClick={() => setShowConversation(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto max-h-96">
              {selectedCall.conversation_events && selectedCall.conversation_events.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {selectedCall.conversation_events.map((event, index) => {
                    const isUser = event.speaker === 'user';
                    const isAssistant = event.speaker === 'assistant';
                    const isSystem = event.speaker === 'system';
                    
                    // Skip system events for cleaner display
                    if (isSystem) return null;
                    
                    const Icon = isUser ? Phone : Bot;
                    
                    return (
                      <div key={event.id || index} className="flex items-start gap-3">
                        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                          isUser
                            ? "bg-background border-border"
                            : "bg-secondary border-secondary"
                        }`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-sm font-medium ${
                              isUser ? "text-muted-foreground" : "text-foreground"
                            }`}>
                              {isUser ? "Caller" : "Assistant"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed break-words">
                            {event.content}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No conversation details available for this call.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
} 