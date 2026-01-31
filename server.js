/* server.js */
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store user info: { socketId: { roomId, username, lang } }
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
        // data contains: { roomId, text, sourceLang, username }
        socket.broadcast.to(data.roomId).emit('receive-speak-data', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
