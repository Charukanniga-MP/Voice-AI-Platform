# KAIRA – AI-Powered Customer Communication & Voice Agent Platform

KAIRA is a production-ready, full-stack, AI-powered customer communication platform featuring real-time, bidirectional voice calling, strict Knowledge Base grounding, and automatic live voice escalation to human Administrators.

---

## 🚀 Key Features

1. **Unified Authentication & Automatic Role Routing**
   - **ONE unified login page** (`/login`) for all three roles: **Customer**, **Agent**, and **Admin**.
   - No separate login portals or manual role selectors. The system automatically inspects credentials and redirects to the appropriate dashboard.
   - **Default Admin Account**: `admin@kaira` / `kaira@123`
   - **Default Agent Account**: `agent@kaira` / `kaira@123`
   - **Customer Self-Registration**: Only customers can register new accounts.
   - **Google OAuth Integration**: Customers can register and sign in with Google; Admin and Agent access via Google is restricted strictly to pre-authorized accounts.

2. **Customer Dashboard & Autonomous AI Voice Agent**
   - Real-time bidirectional voice calling (`getUserMedia` audio stream + Web Speech API + SpeechSynthesis).
   - Starts with a natural greeting: *"Hello! Welcome to KAIRA. I am your AI assistant. How may I help you today?"*
   - Real-time Speech-to-Text transcription and live conversation transcript.
   - Microphone mute/unmute, speaker volume slider, and duration timer.
   - Displays customer's own call history with transcript inspection.

3. **Strict Knowledge Base Grounding**
   - The AI voice agent answers **exclusively** from approved, Admin-managed Knowledge Base records.
   - Out-of-scope or unverified questions are **never hallucinated**.
   - If reliable company knowledge is unavailable, the AI speaks the exact fallback:
     > *"I'm sorry, I couldn't find the information you're looking for. Please hold while I connect you with our Admin."*
   - Immediately initiates automatic live call transfer!

4. **Automatic Live Call Transfer to Admin**
   - **Real live two-way voice connection** established between Customer and Admin via WebSockets & WebRTC.
   - Admin receives an instant real-time incoming call modal with sound alert:
     - Customer Name, Phone Number, original question, reason for transfer, and duration.
   - Upon clicking **Accept**, the customer is connected directly to the Admin over two-way audio.
   - The AI agent ceases speaking, and human conversation continues with real-time transcript updates.
   - If Admin rejects or times out (30s), the customer is politely informed and the unanswered question is saved to Admin's pending follow-up queue.

5. **Support Agent Dashboard**
   - Incoming call handling with Accept / Reject.
   - Outgoing calls with real-time customer directory search and "Initiate Call" button.
   - Active call console with live microphone/speaker controls and live transcripts.
   - **Strict Read-Only Knowledge Base**: Agents can search and read knowledge to support customers, but cannot add, edit, delete, or upload documents.

6. **Admin Dashboard (Full Control)**
   - **Section A: Dashboard Overview**: 8 operational metric cards computed from real database records (Total Customers, Incoming Calls, Outgoing Calls, Total Calls, Active Calls, Completed Calls, Transferred Calls, Pending Transfers).
   - **Section B: Customer Management**: Full CRUD (Search, Add customer, Edit, Delete with confirmation, View customer call history).
   - **Section C: Call Monitoring**: Filter by All, Incoming, Outgoing, Transferred, Active, Completed, Missed. View complete details and conversation transcripts.
   - **Section D: Live Call Transfer Management**: Active transferred call console, transfer queue, and pending follow-ups.
   - **Section E: Knowledge Base Management**: Upload PDF and DOCX documents with automated text parsing and indexing, add Q&A entries, edit/delete entries with immediate retrieval sync.

---

## 🛠 Technology Stack

- **Backend**: Node.js, Express, Socket.IO, Prisma ORM, SQLite (`server/prisma/dev.db`), `bcryptjs`, `jsonwebtoken`, `multer`, `pdf-parse`, `mammoth`, `openai`.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, WebRTC Audio Manager, Web Speech API.
- **Database**: Persistent relational SQLite schema with ACID constraints.

---

## 📦 Running the Platform

### Option 1: Running Concurrently (Development)
```bash
# Terminal 1: Backend Server (Port 5000)
cd server
npm run dev

# Terminal 2: Frontend Client (Port 5173)
cd client
npm run dev
```

### Option 2: Production Unified Server
```bash
cd client && npm run build
cd ../server && npm start
# Access the platform at http://localhost:5000
```

---

## 🔑 Default Credentials

| Role | Username / Email | Password |
|---|---|---|
| **Administrator** | `admin@kaira` | `kaira@123` |
| **Support Agent** | `agent@kaira` | `kaira@123` |
| **Demo Customer** | `alex.morgan@example.com` | `customer@123` |
| **New Customer** | Self-register on the unified login page | User choice |

---

## 🧪 Verification & Automated Tests

All automated unit and end-to-end integration tests have been executed and verified:
```bash
# Test 1: Authentication & RBAC verification
cd server && npx tsx src/test-auth.ts

# Test 2: Knowledge Base CRUD & Search Indexing
cd server && npx tsx src/test-kb.ts

# Test 3: Complete AI Voice Calling & Automatic Admin Call Transfer Workflow
cd server && npx tsx src/test-transfer-workflow.ts
```

