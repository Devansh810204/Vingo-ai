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
                model: 'gemini-2.5-pro',
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

    // Handle Mobile Audio Transcription via Gemini
    socket.on('request-audio-transcription', async (data) => {
        // data contains: { base64Audio, mimeType, sourceLang }
        if (!process.env.GEMINI_API_KEY) {
            console.warn("No Gemini API key configured for audio transcription.");
            return;
        }

        try {
            const prompt = `Transcribe the spoken words in this audio recording. The speaker is speaking in '${data.sourceLang}'. Return ONLY the exact transcribed text, without any additional comments, formatting, quotation marks, or meta-commentary. If there is only silence or no clear words, return nothing.`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: [
                    {
                        inlineData: {
                            data: data.base64Audio,
                            mimeType: data.mimeType
                        }
                    },
                    prompt
                ]
            });

            const text = response.text.trim();
            if (text && text.length > 1) {
                console.log(`[Gemini Transcribed] Room ${users[socket.id]?.roomId} - ${users[socket.id]?.username}: ${text}`);
                
                const roomId = users[socket.id]?.roomId;
                if (roomId) {
                    io.to(roomId).emit('receive-speak-data', {
                        userId: socket.id,
                        text: text,
                        sourceLang: data.sourceLang,
                        username: users[socket.id]?.username || "User",
                        isFinal: true
                    });
                }
            }
        } catch (error) {
            console.error("Gemini Audio Transcription Error:", error);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
