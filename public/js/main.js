// --- GLOBALS ---
let socket;
let myIdx;
let gameState;
let handHidden = false;
let lastTurnIdx = -1;

function connect() {
    unlockAudioContext();
    const user = document.getElementById('username').value;

    // Auto-detect host
    socket = io({
        query: { name: user }
    });

    socket.on('connect', () => {
        socket.emit('LOGIN', { name: user });
    });

    socket.on('LOBBY_UPDATE', (msg) => {
        document.getElementById('screen-login').classList.remove('active');
        document.getElementById('screen-lobby').classList.add('active');
        document.getElementById('lobby-msg').innerText = msg.count + " Joueurs";
        document.getElementById('btn-start').disabled = !msg.ready;
    });

    socket.on('STATE_UPDATE', (msg) => {
        const oldDeclarer = gameState ? gameState.last_declarer_idx : null;
        const oldTurn = gameState ? gameState.current_player_idx : null;
        document.getElementById('ui-chat').style.display = 'flex';

        gameState = msg;
        myIdx = msg.my_idx;

        if (msg.new_round) {
            document.body.classList.remove('revolution-active');
        }

        // Mode Effects
        if (msg.new_round) {
            if (msg.is_double_penalty) {
                triggerModePopup("MORT SUBITE", "Les dégâts sont doublés ! (x2)", "💀", "pop-red");
                playSfx('matou');
            }
            else if (msg.is_timer_mode) {
                triggerModePopup("CHRONO", "10 secondes pour jouer !", "⏳", "pop-beige");
                playSfx('bid');
            }
            else if (msg.effect === 'REVOLUTION') {
                triggerModePopup("RÉVOLUTION", "Les mains ont tourné !", "🔄", "pop-purple");
                playSfx('germinal');
            }
            else if (msg.is_blind) {
                triggerModePopup("PANNE DE COURANT", "On joue à l'aveugle...", "🔦", "");
                playSfx('blind');
            }
        }

        // Timer
        if (msg.is_timer_mode) {
            if (msg.new_round || msg.current_player_idx !== lastTurnIdx) {
                restartTimerAnim();
                lastTurnIdx = msg.current_player_idx;
            }
            document.body.classList.add('timer-mode');
        } else {
            stopTimerAnim();
            document.body.classList.remove('timer-mode');
        }

        if (msg.is_double_penalty) {
            document.body.classList.add('double-penalty-mode');
            if (msg.new_round) {
                playSfx('matou');
                showFeedback(myIdx, "💀 MORT SUBITE (+2)", "#e74c3c");
            }
        } else {
            document.body.classList.remove('double-penalty-mode');
        }

        if (msg.effect === 'REVOLUTION') {
            document.body.classList.add('revolution-active');
            if (msg.new_round) {
                playSfx('germinal');
                showFeedback(myIdx, "🔄 RÉVOLUTION !", "#9b59b6");
            }
        }

        if (msg.is_blind) {
            document.body.classList.add('blind-mode');
            if (msg.new_round) playSfx('blind');
        } else {
            document.body.classList.remove('blind-mode');
        }

        // Screens
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-game').classList.add('active');

        // Sounds & Logs
        if (msg.new_round) {
            resetGameInputs();
            showFeedback(gameState.current_player_idx, "C'est parti !", "#f1c40f");
            playSfx('start');
        }

        if (gameState.last_declarer_idx !== null && gameState.last_declarer_idx !== oldDeclarer && !msg.new_round) {
            playSfx('bid');
            showFeedback(gameState.last_declarer_idx, "A ENCHÉRI", "#fff");
        }

        if (myIdx === gameState.current_player_idx && oldTurn !== myIdx) {
            setTimeout(() => playSfx('turn'), 500);
        }

        render();
    });

    socket.on('CHAT_MSG', (msg) => {
        const div = document.getElementById('chat-history');
        const line = document.createElement('div');
        line.className = 'chat-msg';
        line.innerHTML = `<span class="chat-author">${msg.author}:</span> ${msg.text.replace(/</g, "&lt;")}`;
        div.prepend(line);

        const chat = document.getElementById('ui-chat');
        if (chat.classList.contains('closed')) {
            chat.classList.add('has-new');
            showChatToast(msg.author, msg.text);
        }
    });

    socket.on('ERROR', (msg) => alert(msg.msg));

    socket.on('SHOWDOWN', (msg) => {
        if (msg.is_truth) playSfx('truth_hurt');
        else playSfx('lie_found');

        document.body.classList.add('shake-screen');
        setTimeout(() => document.body.classList.remove('shake-screen'), 500);
        showResult(msg);
    });

    socket.on('GAME_OVER', (msg) => {
        alert("GAGNANT: " + msg.winner);
        location.reload();
    });

    socket.on('EMOTE', (msg) => {
        showEmote(msg.idx, msg.content);
        if (SOUNDS[msg.content]) playSfx(msg.content);
    });
}

function send(type, data = {}) {
    if (socket) socket.emit(type, data);
}

// --- ACTIONS ---

function sendEmote(emoji) {
    send('EMOTE', { content: emoji });
}

function bid() {
    const getVal = (id) => document.getElementById(id).value;
    let d = {
        combo: getVal('c1-combo'), rank1: getVal('c1-r1'), rank2: getVal('c1-r2'), suit: getVal('c1-suit')
    };
    if (document.getElementById('check-split').checked) {
        d.sec_combo = getVal('c2-combo'); d.sec_rank1 = getVal('c2-r1');
        d.sec_rank2 = getVal('c2-r2'); d.sec_suit = getVal('c2-suit');
    }
    send('BID', { claim: d });
}

function sendChat() {
    const inp = document.getElementById('chat-input');
    const txt = inp.value.trim();
    if (!txt) return;
    send('CHAT', { content: txt });
    inp.value = '';
    inp.focus();
}

// --- INPUTS & EVENTS ---

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
        case ' ': case 's': case 'S':
            e.preventDefault();
            toggleHand();
            break;
        case '1': case '&': sendEmote('gelo'); break;
        case '2': case 'é': sendEmote('max'); break;
        case '3': case '"': sendEmote('ciliem'); break;
        case '4': case "'": sendEmote('matou'); break;
        case '5': case '(': sendEmote('germinal'); break;
    }
});

function moveTorch(x, y) {
    document.documentElement.style.setProperty('--cursor-x', x + 'px');
    document.documentElement.style.setProperty('--cursor-y', y + 'px');
}

document.addEventListener('mousemove', e => moveTorch(e.clientX, e.clientY));
document.addEventListener('touchmove', e => {
    moveTorch(e.touches[0].clientX, e.touches[0].clientY);
});

// Initialization
initSelects('c1');
initSelects('c2', true);
updateInputs(1);
updateInputs(2);
