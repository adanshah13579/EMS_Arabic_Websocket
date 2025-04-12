const express = require("express");
const http = require("http");
const cors = require("cors");
const connectDB = require("./config/database");
const socketService = require("./services/socketService");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// REFERENCE
// LISTEN ON receive_Message , Conversations , Recent_Messages
// SENDING EVENTS Get_Conversations, send_Message, Get_Recent_Messages
connectDB();
socketService(server);

server.listen(process.env.PORT, () =>
  console.log(`Server running on port ${process.env.PORT}`)
);
