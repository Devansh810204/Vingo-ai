const socket = io();

// --- CONFIGURATION ---
const API_URL = "https://translate.googleapis.com/translate_a/single?client=gtx";
const STUN_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- STATE VARIABLES ---
let localStream;
let myUsername = "User-" + Math.floor(Math.random() * 1000);
let roomId = "";
let myLang = "en-US";
let listenLang = "en-US";
let recognition;
let subtitlesOn = true;
const peers = {};

// --- CHANGED: Default Media State to OFF ---
let isMuted = true;      // Start Muted
let isVideoOff = true;   // Start with Camera Off
let originalAudioOn = false; // Start with Original Audio muted

// --- 1. SETUP & NAVIGATION ---

// Add keyboard shortcuts and initialize particles
document.addEventListener('DOMContentLoaded', () => {
    // Keyboard shortcuts
    document.getElementById('username').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') goToSetup();
    });

    document.getElementById('room-id').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') joinRoom();
    });

    // Initialize particles.js for the AI Theme Background
    if (window.particlesJS) {
        particlesJS("particles-js", {
            "particles": {
                "number": { "value": 80, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#00f3ff" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.5, "random": false, "anim": { "enable": true, "speed": 1, "opacity_min": 0.1, "sync": false } },
                "size": { "value": 3, "random": true, "anim": { "enable": false, "speed": 40, "size_min": 0.1, "sync": false } },
                "line_linked": { "enable": true, "distance": 150, "color": "#7000ff", "opacity": 0.4, "width": 1 },
                "move": { "enable": true, "speed": 2, "direction": "none", "random": false, "straight": false, "out_mode": "out", "bounce": false, "attract": { "enable": false, "rotateX": 600, "rotateY": 1200 } }
            },
            "interactivity": {
                "detect_on": "canvas",
                "events": { "onhover": { "enable": true, "mode": "grab" }, "onclick": { "enable": true, "mode": "push" }, "resize": true },
                "modes": { "grab": { "distance": 140, "line_linked": { "opacity": 1 } }, "push": { "particles_nb": 4 } }
            },
            "retina_detect": true
        });
    }
});

function goToSetup() {
    const input = document.getElementById('username');
    if (input.value.trim()) myUsername = input.value;
    else return alert("Please enter your name");

    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('setup-screen').classList.add('active');
}

function toggleSettings() {
    document.getElementById('settings-panel').classList.toggle('hidden');
}

async function joinRoom() {
    roomId = document.getElementById('room-id').value;
    if (!roomId) return alert("Please enter a Room ID");

    // Get selected languages
    myLang = document.getElementById('setup-my-lang').value;
    listenLang = document.getElementById('setup-listen-lang').value;

    // Sync UI
    document.getElementById('in-call-my-lang').value = myLang;
    document.getElementById('in-call-listen-lang').value = listenLang;

    // Switch Screens
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('call-screen').classList.add('active');
    document.getElementById('display-room-id').innerText = roomId;
    document.querySelector('#local-wrapper .label').innerText = "You";

    try {
        // 1. Get Media Stream (We must ask for permission first)
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: { echoCancellation: true, noiseSuppression: true }
        });

        // 2. IMMEDIATELY TURN OFF TRACKS (Default Off)
        localStream.getAudioTracks()[0].enabled = false;
        localStream.getVideoTracks()[0].enabled = false;

        // 3. Update UI to show they are OFF
        updateInitialButtonState();

        document.getElementById('local-video').srcObject = localStream;

        // 4. Initialize Logic
        initSpeechRecognition();
        socket.emit('join-room', roomId, myUsername, myLang);

    } catch (err) {
        console.error("Media Error:", err);
        alert("⚠️ Camera/Mic Error: " + err.message);
    }
}

// New Helper to set button colors correctly on load
function updateInitialButtonState() {
    const muteBtn = document.getElementById('mute-btn');
    const videoBtn = document.getElementById('video-btn');

    // Mute Button: Show Red (Off)
    muteBtn.innerHTML = "<span>🔴</span>";
    muteBtn.classList.remove('active'); // Remove 'active' (green) style

    // Video Button: Show Red (Off)
    videoBtn.innerHTML = "<span>🚫</span>";
    videoBtn.classList.add('danger');   // Add 'danger' (red) style
}

function updateLanguages() {
    myLang = document.getElementById('in-call-my-lang').value;
    listenLang = document.getElementById('in-call-listen-lang').value;

    if (recognition) {
        recognition.stop();
    }
    toggleSettings();
}

// --- 2. SPEECH RECOGNITION ---

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Browser not supported. Use Chrome.");

    recognition = new SpeechRecognition();
    recognition.lang = myLang;
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
        setAIStatus('listening', 'AI Listening...');
        document.getElementById('local-wrapper').classList.add('speaking');
    };

    recognition.onerror = (e) => {
        setAIStatus('', 'AI Standby');
        document.getElementById('local-wrapper').classList.remove('speaking');
    };

    recognition.onend = () => {
        document.getElementById('local-wrapper').classList.remove('speaking');
        setAIStatus('', 'AI Standby');
        if (!isMuted) {
            try { recognition.start(); } catch (e) { }
        }
    };

    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript;
        socket.emit('speak-data', { roomId, text, sourceLang: myLang, username: myUsername });
    };

    if (!isMuted) {
        try { recognition.start(); } catch (e) { }
    }
}

// Helper to update AI Status UI
function setAIStatus(state, text) {
    const dot = document.querySelector('.status-dot');
    const label = document.getElementById('ai-status-text');
    if (!dot || !label) return;

    dot.className = 'status-dot ' + state;
    label.innerText = text;
}

// --- 3. TRANSLATION ---

socket.on('receive-speak-data', async (data) => {
    let finalText = data.text;
    const sourceCode = data.sourceLang.split('-')[0];
    const targetCode = listenLang.split('-')[0];

    // Show visual indicator that someone is speaking
    const wrapper = document.getElementById(`wrapper-${data.userId}`);
    if (wrapper) wrapper.classList.add('speaking');

    if (sourceCode !== targetCode) {
        setAIStatus('translating', 'AI Translating...');
        try {
            finalText = await translateText(data.text, sourceCode, targetCode);
        } catch (err) {
            console.error(err);
        }
        setAIStatus('listening', 'AI Listening...');
    }

    if (wrapper) setTimeout(() => wrapper.classList.remove('speaking'), 3000);

    if (subtitlesOn && finalText) {
        const subBox = document.getElementById('subtitle-text');
        const container = document.querySelector('.glass-subtitle');
        if (subBox) {
            subBox.innerHTML = `<span style="color:var(--primary); font-weight:bold;">${data.username}:</span> ${finalText}`;
            if (container) container.style.opacity = 1;

            setTimeout(() => {
                // Only hide if it hasn't been overwritten by a newer message yet
                if (subBox.innerHTML.includes(finalText) && container) {
                    container.style.opacity = 0;
                }
            }, 6000);
        }
    }

    if (finalText) speakText(finalText, listenLang);
});

async function translateText(text, source, target) {
    // If the user speaks the language they are listening to, don't translate
    if (source.split('-')[0] === target.split('-')[0]) return text;

    const url = `${API_URL}&sl=${source.split('-')[0]}&tl=${target.split('-')[0]}&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data && data[0]) {
            let fullTranslation = "";
            for (let i = 0; i < data[0].length; i++) {
                if (data[0][i][0]) {
                    fullTranslation += data[0][i][0] + " ";
                }
            }
            return fullTranslation.trim();
        }
        return text; // Fallback to original text if parsing fails
    } catch (err) {
        console.error("Translation API Error:", err);
        return text; // Fallback to original text if network fails
    }
}

function speakText(text, lang) {
    if (!window.speechSynthesis) return;
    // Removed window.speechSynthesis.cancel() so sentences queue up nicely
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.speak(u);
}

// --- 4. WEBRTC ---

socket.on('user-connected', async (data) => {
    const pc = createPeer(data.userId, data.username);
    peers[data.userId] = pc;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { target: data.userId, offer: offer });
});

socket.on('offer', async (data) => {
    const pc = createPeer(data.callerId, data.callerName);
    peers[data.callerId] = pc;
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { target: data.callerId, answer: answer });
});

socket.on('answer', async (data) => {
    if (peers[data.responderId]) await peers[data.responderId].setRemoteDescription(data.answer);
});

socket.on('ice-candidate', async (data) => {
    if (peers[data.senderId]) await peers[data.senderId].addIceCandidate(data.candidate);
});

socket.on('user-disconnected', (userId) => {
    if (peers[userId]) peers[userId].close();
    delete peers[userId];
    const el = document.getElementById(`wrapper-${userId}`);
    if (el) el.remove();
});

function createPeer(userId, username) {
    const pc = new RTCPeerConnection(STUN_CONFIG);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        if (!document.getElementById(`wrapper-${userId}`)) {
            const div = document.createElement('div');
            div.className = 'video-wrapper';
            div.id = `wrapper-${userId}`;

            const vid = document.createElement('video');
            vid.srcObject = event.streams[0];
            vid.autoplay = true;
            vid.playsInline = true;
            vid.muted = !originalAudioOn; // Mute based on state

            const lbl = document.createElement('span');
            lbl.className = 'label';
            lbl.innerText = username;

            div.appendChild(vid);
            div.appendChild(lbl);
            document.getElementById('video-grid').appendChild(div);
        }
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { target: userId, candidate: e.candidate });
    };
    return pc;
}

// --- 5. CONTROLS ---

function toggleMute() {
    isMuted = !isMuted;

    // Toggle Track
    if (localStream) localStream.getAudioTracks()[0].enabled = !isMuted;

    // Toggle UI
    const btn = document.getElementById('mute-btn');
    btn.innerHTML = isMuted ? "<span>🔴</span>" : "<span>🎤</span>";
    btn.classList.toggle('active', !isMuted);

    if (isMuted) {
        setAIStatus('', 'AI Standby');
        document.getElementById('local-wrapper').classList.remove('speaking');
        try { recognition.stop(); } catch (e) { }
    } else {
        setAIStatus('listening', 'AI Listening...');
        try { recognition.start(); } catch (e) { }
    }
}

function toggleVideo() {
    isVideoOff = !isVideoOff;

    // Toggle Track
    if (localStream) localStream.getVideoTracks()[0].enabled = !isVideoOff;

    // Toggle UI
    const btn = document.getElementById('video-btn');
    btn.innerHTML = isVideoOff ? "<span>🚫</span>" : "<span>📷</span>";
    btn.classList.toggle('danger', isVideoOff);
}

function toggleSubtitles() {
    subtitlesOn = !subtitlesOn;
    document.getElementById('cc-btn').classList.toggle('active', subtitlesOn);
}

function toggleOriginalAudio() {
    originalAudioOn = !originalAudioOn;

    // Toggle all remote videos' mute state
    const remoteVideos = document.querySelectorAll('#video-grid .video-wrapper:not(#local-wrapper) video');
    remoteVideos.forEach(vid => {
        vid.muted = !originalAudioOn;
    });

    const btn = document.getElementById('audio-btn');
    btn.innerHTML = originalAudioOn ? "<span>🔊</span>" : "<span>🔇</span>";
    btn.classList.toggle('danger', !originalAudioOn);
    btn.classList.toggle('active', originalAudioOn);
}

function leaveCall() {
    location.reload();
}