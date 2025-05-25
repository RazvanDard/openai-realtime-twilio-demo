"use client";

import React, { useState, useEffect } from "react";
import TopBar from "@/components/top-bar";
import ChecklistAndConfig from "@/components/checklist-and-config";
import SessionConfigurationPanel from "@/components/session-configuration-panel";
import Transcript from "@/components/transcript";
import FunctionCallsPanel from "@/components/function-calls-panel";
import OutboundCallPanel from "@/components/outbound-call-panel";
import CallHistoryPanel from "@/components/call-history-panel";
import { Item } from "@/components/types";
import handleRealtimeEvent from "@/lib/handle-realtime-event";
import PhoneNumberChecklist from "@/components/phone-number-checklist";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

const CallInterface = () => {
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState("");
  const [allConfigsReady, setAllConfigsReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [callStatus, setCallStatus] = useState("disconnected");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const { user, signOut } = useAuth();

  useEffect(() => {
    if (allConfigsReady && !ws && user) {
      const connectWebSocket = async () => {
        try {
          // Get the JWT token for authentication
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.access_token) {
            console.error('No authentication token available');
            return;
          }

          const wsUrl = new URL("ws://localhost:8081/logs");
          wsUrl.searchParams.set('token', session.access_token);
          
          const newWs = new WebSocket(wsUrl.toString());

          newWs.onopen = () => {
            console.log("Connected to logs websocket");
            setCallStatus("connected");
          };

          newWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log("Received logs event:", data);
            handleRealtimeEvent(data, setItems);
          };

          newWs.onclose = () => {
            console.log("Logs websocket disconnected");
            setWs(null);
            setCallStatus("disconnected");
          };

          newWs.onerror = (error) => {
            console.error("WebSocket error:", error);
            setCallStatus("error");
          };

          setWs(newWs);
        } catch (error) {
          console.error("Failed to connect WebSocket:", error);
        }
      };

      connectWebSocket();
    }
  }, [allConfigsReady, ws, user]);

  const handleCallInitiated = (callSid: string) => {
    console.log("Outbound call initiated:", callSid);
    // You can add additional logic here, like updating UI state
  };

  return (
    <div className="h-screen bg-white flex flex-col">
      <ChecklistAndConfig
        ready={allConfigsReady}
        setReady={setAllConfigsReady}
        selectedPhoneNumber={selectedPhoneNumber}
        setSelectedPhoneNumber={setSelectedPhoneNumber}
      />
      <TopBar />
      <div className="flex-grow p-4 h-full overflow-hidden flex flex-col">
        <div className="grid grid-cols-12 gap-4 h-full">
          {/* Left Column */}
          <div className="col-span-3 flex flex-col h-full overflow-hidden space-y-4">
            <SessionConfigurationPanel
              callStatus={callStatus}
              onSave={(config) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                  const updateEvent = {
                    type: "session.update",
                    session: {
                      ...config,
                    },
                  };
                  console.log("Sending update event:", updateEvent);
                  ws.send(JSON.stringify(updateEvent));
                }
              }}
            />
            <OutboundCallPanel onCallInitiated={handleCallInitiated} />
            <div className="mt-auto">
              <button
                onClick={signOut}
                className="w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Middle Column: Transcript */}
          <div className="col-span-6 flex flex-col gap-4 h-full overflow-hidden">
            <PhoneNumberChecklist
              selectedPhoneNumber={selectedPhoneNumber}
              allConfigsReady={allConfigsReady}
              setAllConfigsReady={setAllConfigsReady}
            />
            <Transcript items={items} />
          </div>

          {/* Right Column: Call History */}
          <div className="col-span-3 flex flex-col h-full overflow-hidden">
            <CallHistoryPanel />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallInterface;
