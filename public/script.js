const socket = io();

// --- CONFIGURATION ---
const API_URL = "https://api.mymemory.translated.net/get";
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

// --- 1. SETUP & NAVIGATION ---

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

    recognition.onstart = () => console.log("🟢 Listening...");
    recognition.onerror = (e) => console.error("🔴 AI Error:", e.error);
    
    recognition.onend = () => {
        // Only restart if user is NOT muted
        if(!isMuted) {
            try { recognition.start(); } catch(e) {}
        }
    };

    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript;
        socket.emit('speak-data', { roomId, text, sourceLang: myLang, username: myUsername });
    };

    // START ONLY IF UNMUTED (Since we default to muted, this won't run initially)
    if(!isMuted) {
        try { recognition.start(); } catch(e) {}
    }
}

// --- 3. TRANSLATION ---

socket.on('receive-speak-data', async (data) => {
    let finalText = data.text;
    const sourceCode = data.sourceLang.split('-')[0];
    const targetCode = listenLang.split('-')[0];

    if (sourceCode !== targetCode) {
        try {
            finalText = await translateText(data.text, sourceCode, targetCode);
        } catch (err) {
            // Fallback to original text
        }
    }

    if (subtitlesOn) {
        const subBox = document.getElementById('subtitle-text');
        subBox.innerHTML = `<span style="color:#2ed573; font-weight:bold;">${data.username}:</span> ${finalText}`;
        subBox.style.opacity = 1;
        setTimeout(() => { if(subBox.innerHTML.includes(finalText)) subBox.style.opacity = 0; }, 6000);
    }

    speakText(finalText, listenLang);
});

async function translateText(text, source, target) {
    const url = `${API_URL}?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus === 200) return data.responseData.translatedText;
    throw new Error(data.responseDetails);
}

function speakText(text, lang) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
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
    if(peers[data.responderId]) await peers[data.responderId].setRemoteDescription(data.answer);
});

socket.on('ice-candidate', async (data) => {
    if(peers[data.senderId]) await peers[data.senderId].addIceCandidate(data.candidate);
});

socket.on('user-disconnected', (userId) => {
    if(peers[userId]) peers[userId].close();
    delete peers[userId];
    const el = document.getElementById(`wrapper-${userId}`);
    if(el) el.remove();
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
            
            const lbl = document.createElement('span');
            lbl.className = 'label';
            lbl.innerText = username;

            div.appendChild(vid);
            div.appendChild(lbl);
            document.getElementById('video-grid').appendChild(div);
        }
    };
    
    pc.onicecandidate = (e) => {
        if(e.candidate) socket.emit('ice-candidate', { target: userId, candidate: e.candidate });
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

    // Toggle AI
    if(isMuted) {
        try { recognition.stop(); } catch(e) {}
    } else {
        try { recognition.start(); } catch(e) {}
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

function leaveCall() {
    location.reload();
}