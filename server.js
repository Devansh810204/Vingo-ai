/* server.js */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Initialize Gemini Client (Will use process.env.GEMINI_API_KEY automatically if available)
const ai = new GoogleGenAI({});

// Store user info: { socketId: { roomId, username, myLang } }
const users = {}; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', (roomId, username, myLang) => {
        socket.join(roomId);
        users[socket.id] = { roomId, username, myLang };

        // Tell everyone else in the room that a new user joined, sending their name
        socket.to(roomId).emit('user-connected', {
            userId: socket.id,
            username: username
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', socket.id);
            delete users[socket.id];
        });
    });

    // Handle Signaling (Offer/Answer/Ice) - Directed to specific user
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', {
            offer: data.offer,
            callerId: socket.id,
            callerName: users[socket.id]?.username || "Unknown"
        });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', {
            answer: data.answer,
            responderId: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    // Handle Translation Data (Broadcast to room)
    socket.on('speak-data', (data) => {
        // data contains: { roomId, text, sourceLang, username, isFinal }
        socket.broadcast.to(data.roomId).emit('receive-speak-data', data);
    });

    // Handle Secure Backend Translation via Gemini
    socket.on('request-translation', async (data) => {
        // data contains: { text, sourceCode, targetCode, contextToken }
        if (!process.env.GEMINI_API_KEY) {
            return socket.emit('translation-result', { error: "No API Key configured on server.", originalText: data.text, contextToken: data.contextToken });
        }

        try {
            const prompt = `Translate the following text from ISO 639-1 code '${data.sourceCode}' to '${data.targetCode}'. Respond ONLY with the exact translated text without formatting, quotes, or markdown. Text: ${data.text}`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            socket.emit('translation-result', {
                translatedText: response.text.trim(),
                originalText: data.text,
                contextToken: data.contextToken
            });
        } catch (error) {
            console.error("Gemini API Error:", error);
            socket.emit('translation-result', { error: "API Failure", originalText: data.text, contextToken: data.contextToken });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
