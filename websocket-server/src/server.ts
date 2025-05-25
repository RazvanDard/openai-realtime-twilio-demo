import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";
import {
  handleCallConnection,
  handleFrontendConnection,
} from "./userSessionManager";
import { authenticateToken, AuthenticatedRequest, extractUserIdFromToken } from "./authMiddleware";
import { initiateOutboundCall, formatPhoneNumber } from "./outboundCallService";
import { OutboundCallRequest, CallHistoryQuery } from "./types";
import functions from "./functionHandlers";
import { 
  getCallHistory, 
  getCallBySid, 
  getCallHistoryStats 
} from "./callHistoryService";

dotenv.config();

const PORT = parseInt(process.env.PORT || "8081", 10);
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY environment variable is required");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL });
});

app.all("/twiml", (req, res) => {
  const wsUrl = new URL(PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;

  console.log(`TwiML request - generating clean WebSocket URL`);

  const finalWsUrl = wsUrl.toString();
  console.log(`Generated WebSocket URL: ${finalWsUrl}`);

  const twimlContent = twimlTemplate.replace("{{WS_URL}}", finalWsUrl);
  res.type("text/xml").send(twimlContent);
});

// New endpoint to list available tools (schemas)
app.get("/tools", (req, res) => {
  res.json(functions.map((f) => f.schema));
});

// Protected endpoint to initiate outbound calls
app.post("/outbound-call", authenticateToken, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { phoneNumber } = req.body;
    const userId = req.userId!;

    if (!phoneNumber) {
      res.status(400).json({ error: "Phone number is required" });
      return;
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    const callRequest: OutboundCallRequest = {
      phoneNumber: formattedNumber,
      userId,
    };

    const callSid = await initiateOutboundCall(callRequest);
    res.json({ 
      success: true, 
      callSid,
      message: "Outbound call initiated successfully" 
    });
  } catch (error: any) {
    console.error("Outbound call error:", error);
    res.status(500).json({ 
      error: "Failed to initiate outbound call",
      details: error.message 
    });
  }
});

// Protected endpoint to get call history
app.get("/call-history", authenticateToken, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const { phoneNumber, startDate, endDate, limit, offset } = req.query;

    const query: CallHistoryQuery = {
      userId,
      phoneNumber: phoneNumber as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    };

    const result = await getCallHistory(query);
    res.json(result);
  } catch (error: any) {
    console.error("Call history error:", error);
    res.status(500).json({ 
      error: "Failed to get call history",
      details: error.message 
    });
  }
});

// Protected endpoint to get call history statistics
app.get("/call-history/stats", authenticateToken, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const stats = await getCallHistoryStats(userId);
    res.json(stats);
  } catch (error: any) {
    console.error("Call history stats error:", error);
    res.status(500).json({ 
      error: "Failed to get call history statistics",
      details: error.message 
    });
  }
});

// Protected endpoint to get a specific call by SID
app.get("/call-history/:callSid", authenticateToken, async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { callSid } = req.params;
    const userId = req.userId!;

    const call = await getCallBySid(callSid);
    
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    // Security check: ensure the call belongs to the authenticated user
    if (call.user_id !== userId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    res.json(call);
  } catch (error: any) {
    console.error("Get call by SID error:", error);
    res.status(500).json({ 
      error: "Failed to get call details",
      details: error.message 
    });
  }
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  console.log(`WebSocket connection received: ${req.url}`);
  console.log(`Request headers:`, req.headers);
  
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  console.log(`Parsed URL:`, url.toString());
  console.log(`URL pathname:`, url.pathname);
  console.log(`URL search params:`, url.searchParams.toString());
  
  const parts = url.pathname.split("/").filter(Boolean);
  console.log(`URL parts:`, parts);

  if (parts.length < 1) {
    console.log("Closing connection: no path parts");
    ws.close();
    return;
  }

  const type = parts[0];
  console.log(`Connection type: ${type}`);

  if (type === "call") {
    console.log(`WebSocket call connection - waiting for Call SID identification`);
    
    // Handle all calls generically - we'll identify the user from the Call SID
    // when Twilio sends the "start" event with call metadata
    handleCallConnection(ws, OPENAI_API_KEY);
  } else if (type === "logs") {
    // Extract JWT token from query parameters or headers
    const token = url.searchParams.get('token') || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      console.error('No token provided for logs connection');
      ws.close();
      return;
    }

    handleFrontendConnection(ws, token);
  } else {
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
