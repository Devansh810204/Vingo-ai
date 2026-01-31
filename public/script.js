/* public/script.js */
const socket = io();

// --- STATE VARIABLES ---
let localStream;
let myUsername = "";
let roomId = "";
let myLang = "en-US";
let listenLang = "en-US";
let recognition;
let subtitlesOn = true;
let isMuted = false;
let isVideoOff = false;

// Store connections for multiple users: { socketId: RTCPeerConnection }
const peers = {}; 

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- 1. NAVIGATION & SETUP ---
function goToSetup() {
    const nameInput = document.getElementById('username');
    if (!nameInput.value) return alert("Please enter your name");
    myUsername = nameInput.value;
    
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('setup-screen').classList.add('active');
}

async function joinRoom() {
    roomId = document.getElementById('room-id').value;
    if (!roomId) return alert("Enter Room Code");

    // Sync initial settings to in-call dropdowns
    myLang = document.getElementById('setup-my-lang').value;
    listenLang = document.getElementById('setup-listen-lang').value;
    
    document.getElementById('in-call-my-lang').value = myLang;
    document.getElementById('in-call-listen-lang').value = listenLang;

    // UI Update
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('call-screen').classList.add('active');
    document.getElementById('display-room-id').innerText = roomId;
    document.getElementById('local-label').innerText = myUsername + " (You)";

    // Start Media & Socket
    await startMedia();
    initSpeechRecognition();
    
    // Join logic
    socket.emit('join-room', roomId, myUsername, myLang);
}

async function startMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
    } catch (err) {
        alert("Camera Access Denied! Please allow permissions.");
        console.error(err);
    }
}

// Function to update languages dynamically during call
function updateLanguages() {
    myLang = document.getElementById('in-call-my-lang').value;
    listenLang = document.getElementById('in-call-listen-lang').value;
    
    // Restart recognition with new language
    if (recognition) {
        recognition.stop();
        // It will auto-restart in 'end' event with new lang
    }
    console.log(`Language updated: Speak: ${myLang}, Listen: ${listenLang}`);
}

// --- 2. MULTI-USER WEBRTC LOGIC ---

// New user joined: Create an offer to connect with them
socket.on('user-connected', async (data) => {
    console.log("User Joined:", data.username);
    const userId = data.userId;
    const pc = createPeerConnection(userId, data.username);
    peers[userId] = pc;

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('offer', {
        target: userId,
        offer: offer
    });
});

// User left: Cleanup
socket.on('user-disconnected', (userId) => {
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    const videoWrapper = document.getElementById(`wrapper-${userId}`);
    if (videoWrapper) videoWrapper.remove();
});

// Receive Offer (from new joiner)
socket.on('offer', async (data) => {
    const userId = data.callerId;
    const pc = createPeerConnection(userId, data.callerName);
    peers[userId] = pc;

    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', {
        target: userId,
        answer: answer
    });
});

// Receive Answer
socket.on('answer', async (data) => {
    const pc = peers[data.responderId];
    if (pc) await pc.setRemoteDescription(data.answer);
});

// Receive ICE Candidate
socket.on('ice-candidate', async (data) => {
    const pc = peers[data.senderId];
    if (pc) await pc.addIceCandidate(data.candidate);
});

// Helper: Create Connection
function createPeerConnection(userId, username) {
    const pc = new RTCPeerConnection(config);
    
    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle Remote Stream (Create new video element dynamically)
    pc.ontrack = (event) => {
        // Only create if doesn't exist
        if (!document.getElementById(`wrapper-${userId}`)) {
            const wrapper = document.createElement('div');
            wrapper.className = 'video-wrapper';
            wrapper.id = `wrapper-${userId}`;
            
            const video = document.createElement('video');
            video.srcObject = event.streams[0];
            video.autoplay = true;
            video.playsInline = true;
            
            // Duck audio volume so TTS is clearer
            video.volume = 0.2; 

            const label = document.createElement('span');
            label.className = 'label';
            label.innerText = username; // Use actual username

            wrapper.appendChild(video);
            wrapper.appendChild(label);
            document.getElementById('video-grid').appendChild(wrapper);
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate
            });
        }
    };

    return pc;
}

// --- 3. TRANSLATION & SUBTITLES ---

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return console.log("Speech not supported");

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = myLang;

    recognition.onstart = () => {
        console.log("Voice recognition active: " + myLang);
    };

    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript;
        
        console.log(`Sending: ${text} (${myLang})`);
        socket.emit('speak-data', {
            roomId: roomId,
            text: text,
            sourceLang: myLang,
            username: myUsername
        });
    };

    recognition.onend = () => {
        // Auto-restart if not muted (needed for dynamic lang change)
        if (!isMuted) {
            recognition.lang = myLang;
            recognition.start();
        }
    };

    recognition.start();
}

socket.on('receive-speak-data', async (data) => {
    // 1. Translate
    const translated = await translateText(data.text, data.sourceLang, listenLang);
    
    // 2. Show Caption (with Name)
    if (subtitlesOn) {
        const subBox = document.getElementById('subtitle-text');
        subBox.innerText = `${data.username}: ${translated}`;
        subBox.style.opacity = 1;
        
        // Clear after 6 seconds
        setTimeout(() => { 
            if(subBox.innerText.includes(translated)) subBox.style.opacity = 0; 
        }, 6000);
    }

    // 3. Speak (TTS)
    speakText(translated, listenLang);
});

// Translation API (HTTPS Fixed)
async function translateText(text, source, target) {
    const srcCode = source.split('-')[0];
    const targetCode = target.split('-')[0];
    if (srcCode === targetCode) return text;

    try {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${srcCode}|${targetCode}`);
        const data = await res.json();
        return data.responseData.translatedText;
    } catch (err) {
        console.error("Trans Error", err);
        return text;
    }
}

function speakText(text, lang) {
    // Important: Browser requires user interaction before playing audio. 
    // Since user clicked 'Join', it should work.
    
    window.speechSynthesis.cancel(); // Stop previous
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}

// --- 4. CONTROLS ---

function toggleMute() {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    const btn = document.getElementById('mute-btn');
    btn.innerText = isMuted ? "🔴 Unmute" : "🎤 Mute";
    btn.style.background = isMuted ? "red" : "#007bff";
    
    // Stop recognition to save resources/errors
    if(isMuted) recognition.stop();
    else recognition.start();
}

function toggleVideo() {
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks()[0].enabled = !isVideoOff;
    const btn = document.getElementById('video-btn');
    btn.innerText = isVideoOff ? "📷 Start Video" : "📷 Stop Video";
    btn.style.background = isVideoOff ? "red" : "#007bff";
}

function toggleSubtitles() {
    subtitlesOn = !subtitlesOn;
    const btn = document.getElementById('cc-btn');
    btn.innerText = subtitlesOn ? "📝 CC On" : "CC Off";
    btn.style.background = subtitlesOn ? "#007bff" : "#555";
}

function leaveCall() {
    window.location.reload();
}
