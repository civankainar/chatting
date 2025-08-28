import express from "express";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me"; // Replit Secrets kısmından ver

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/public", express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `${Date.now()}-${uuidv4()}${ext || ".bin"}`);
  },
});
const upload = multer({ storage });

const server = app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);

// WebSocket
const wss = new WebSocketServer({ server });
const sockets = {
  // clientId -> Set<ws>
  clients: new Map(),
  // single admin set (support çoklu admin istersen Set yapısı zaten destekli)
  admins: new Set(),
};

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}
function broadcastToAdmins(obj) {
  for (const adminWs of sockets.admins) send(adminWs, obj);
}
function broadcastToClient(clientId, obj) {
  const set = sockets.clients.get(clientId);
  if (!set) return;
  for (const c of set) send(c, obj);
}

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get("role"); // 'client' | 'admin'
  const token = url.searchParams.get("token");
  const db = await getDb();

  if (role === "admin") {
    if (token !== ADMIN_TOKEN) {
      send(ws, { type: "error", message: "unauthorized" });
      ws.close();
      return;
    }
    sockets.admins.add(ws);
    send(ws, { type: "ready", role: "admin" });
    ws.on("close", () => sockets.admins.delete(ws));

    // admin gelen mesajları WS ile alır/gönderir
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "admin:list") {
        const rows = await db.all(`
          SELECT c.id, c.username,
                 (SELECT content FROM messages m WHERE m.client_id=c.id ORDER BY ts DESC LIMIT 1) as lastContent,
                 (SELECT ts FROM messages m WHERE m.client_id=c.id ORDER BY ts DESC LIMIT 1) as lastTs
          FROM clients c ORDER BY lastTs DESC NULLS LAST, c.created_at DESC
        `);
        send(ws, { type: "admin:list", data: rows });
      }

      if (msg.type === "admin:history" && msg.clientId) {
        const messages = await db.all(
          "SELECT * FROM messages WHERE client_id=? ORDER BY ts ASC",
          [msg.clientId]
        );
        send(ws, { type: "admin:history", clientId: msg.clientId, data: messages });
      }

      if (msg.type === "admin:send" && msg.clientId && msg.payload) {
        const { text, kind } = msg.payload; // kind: 'text'|'image'|'audio'
        const ts = Date.now();
        await db.run(
          "INSERT INTO messages (client_id, sender, type, content, ts) VALUES (?,?,?,?,?)",
          [msg.clientId, "admin", kind || "text", text, ts]
        );
        broadcastToClient(msg.clientId, { type: "message", from: "admin", kind: kind || "text", content: text, ts });
        broadcastToAdmins({ type: "admin:newMessageEcho", clientId: msg.clientId, from: "admin", kind: kind || "text", content: text, ts });
      }

      if (msg.type === "admin:delete" && msg.clientId) {
        await db.run("DELETE FROM messages WHERE client_id=?", [msg.clientId]);
        await db.run("DELETE FROM clients WHERE id=?", [msg.clientId]);
        broadcastToAdmins({ type: "admin:deleted", clientId: msg.clientId });
      }
    });

    return;
  }

  // role=client
  if (role === "client") {
    let clientId = url.searchParams.get("clientId") || uuidv4();
    let username = url.searchParams.get("username") || "Anon";

    // ws map
    if (!sockets.clients.has(clientId)) sockets.clients.set(clientId, new Set());
    sockets.clients.get(clientId).add(ws);

    // client kayıt kontrol/ekle
    const existing = await db.get("SELECT id FROM clients WHERE id=?", [clientId]);
    if (!existing) {
      await db.run("INSERT INTO clients (id, username, created_at) VALUES (?,?,?)", [
        clientId,
        username,
        Date.now(),
      ]);
    } else {
      await db.run("UPDATE clients SET username=? WHERE id=?", [username, clientId]);
    }

    send(ws, { type: "ready", role: "client", clientId });

    ws.on("close", () => {
      const set = sockets.clients.get(clientId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) sockets.clients.delete(clientId);
      }
    });

    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === "client:history") {
        const messages = await db.all(
          "SELECT * FROM messages WHERE client_id=? ORDER BY ts ASC",
          [clientId]
        );
        send(ws, { type: "client:history", data: messages, clientId });
      }

      if (msg.type === "client:send" && msg.payload) {
        const { text, kind } = msg.payload;
        const ts = Date.now();
        await db.run(
          "INSERT INTO messages (client_id, sender, type, content, ts) VALUES (?,?,?,?,?)",
          [clientId, "client", kind || "text", text, ts]
        );
        // adminlere düşür
        broadcastToAdmins({ type: "message", from: "client", clientId, kind: kind || "text", content: text, ts });
        // client echo (mesajın kendi tarafında görünmesi için)
        send(ws, { type: "message", from: "client", kind: kind || "text", content: text, ts });
      }
    });

    return;
  }

  // geçersiz role
  send(ws, { type: "error", message: "invalid role" });
  ws.close();
});

// REST: admin paneli, upload, listeler
app.get("/admin", (req, res) => {
  // admin paneli tek sayfa app
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// admin listeleri (fallback; panel ağırlıkla WS kullanıyor ama lazım olabilir)
app.get("/api/chats", async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const db = await getDb();
  const rows = await db.all("SELECT * FROM clients ORDER BY created_at DESC");
  res.json(rows);
});

app.get("/api/messages/:clientId", async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const db = await getDb();
  const rows = await db.all("SELECT * FROM messages WHERE client_id=? ORDER BY ts ASC", [
    req.params.clientId,
  ]);
  res.json(rows);
});

app.delete("/api/client/:clientId", async (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  const db = await getDb();
  await db.run("DELETE FROM messages WHERE client_id=?", [req.params.clientId]);
  await db.run("DELETE FROM clients WHERE id=?", [req.params.clientId]);
  res.json({ ok: true });
});

// Upload (görsel)
app.post("/api/upload/image", upload.single("file"), async (req, res) => {
  const { clientId, role } = req.body; // 'client' | 'admin'
  if (!clientId || !role) return res.status(400).json({ error: "missing fields" });
  const filepath = `/uploads/${req.file.filename}`;
  const db = await getDb();
  const ts = Date.now();
  await db.run(
    "INSERT INTO messages (client_id, sender, type, content, ts) VALUES (?,?,?,?,?)",
    [clientId, role, "image", filepath, ts]
  );
  if (role === "client") {
    broadcastToAdmins({ type: "message", from: "client", clientId, kind: "image", content: filepath, ts });
    broadcastToClient(clientId, { type: "message", from: "client", kind: "image", content: filepath, ts });
  } else {
    broadcastToClient(clientId, { type: "message", from: "admin", kind: "image", content: filepath, ts });
    broadcastToAdmins({ type: "admin:newMessageEcho", clientId, from: "admin", kind: "image", content: filepath, ts });
  }
  res.json({ ok: true, path: filepath });
});

// Upload (ses - blob)
app.post("/api/upload/audio", upload.single("file"), async (req, res) => {
  const { clientId, role } = req.body;
  if (!clientId || !role) return res.status(400).json({ error: "missing fields" });
  const filepath = `/uploads/${req.file.filename}`;
  const db = await getDb();
  const ts = Date.now();
  await db.run(
    "INSERT INTO messages (client_id, sender, type, content, ts) VALUES (?,?,?,?,?)",
    [clientId, role, "audio", filepath, ts]
  );
  if (role === "client") {
    broadcastToAdmins({ type: "message", from: "client", clientId, kind: "audio", content: filepath, ts });
    broadcastToClient(clientId, { type: "message", from: "client", kind: "audio", content: filepath, ts });
  } else {
    broadcastToClient(clientId, { type: "message", from: "admin", kind: "audio", content: filepath, ts });
    broadcastToAdmins({ type: "admin:newMessageEcho", clientId, from: "admin", kind: "audio", content: filepath, ts });
  }
  res.json({ ok: true, path: filepath });
});

// widget script
app.get("/widget.js", (req, res) => {
  res.type("text/javascript").sendFile(path.join(__dirname, "public", "widget.js"));
});
