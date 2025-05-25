"use client";

import React, { useState } from 'react';
import { useAuth } from './auth-provider';
import { supabase } from '@/lib/supabase';

interface OutboundCallPanelProps {
  onCallInitiated?: (callSid: string) => void;
}

export default function OutboundCallPanel({ onCallInitiated }: OutboundCallPanelProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { user } = useAuth();

  const handleInitiateCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !phoneNumber.trim()) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Get the JWT token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No authentication token available');
      }

      const response = await fetch('http://localhost:8081/outbound-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to initiate call');
      }

      const result = await response.json();
      setSuccess(`Call initiated successfully! Call SID: ${result.callSid}`);
      setPhoneNumber('');
      
      if (onCallInitiated) {
        onCallInitiated(result.callSid);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initiate outbound call');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-4">Make Outbound Call</h3>
      
      <form onSubmit={handleInitiateCall} className="space-y-4">
        <div>
          <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-1">
            Phone Number
          </label>
          <input
            id="phoneNumber"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890 or 1234567890"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            disabled={loading}
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Enter any international phone number (country codes are handled automatically)
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !phoneNumber.trim()}
          className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Initiating Call...' : 'Start Call'}
        </button>
      </form>
    </div>
  );
} 