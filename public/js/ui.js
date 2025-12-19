// --- CONSTANTS & MAPPINGS ---
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const COMBOS = ['Carte', 'Paire', 'Double Paire', 'Brelan', 'Couleur', 'Suite', 'Full', 'Carré', 'QuinteFlush', 'QuinteFlushRoyale'];
const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const RANK_NAMES = { '10': '10', 'J': 'jack', 'Q': 'queen', 'K': 'king', 'A': 'ace' };

// --- HELPERS ---
function getSrc(r, s) {
    let rn = RANK_NAMES[r] || r, sn = SUIT_NAMES[s];
    return `assets/cards/${rn}_of_${sn}.png`;
}

function getComboText(combo, r1, r2, suit) {
    if (!combo) return "";
    if (!r1 && !r2 && !suit) return combo + " (indéfini)";

    switch (combo) {
        case 'Carte': return r1 ? `Carte Haute ${r1}` : "Carte Haute";
        case 'Paire': return r1 ? `Paire de ${r1}` : "Une Paire";
        case 'Double Paire':
            if (r1 && r2) return `Double Paire ${r1} & ${r2}`;
            return "Double Paire";
        case 'Brelan': return r1 ? `Brelan de ${r1}` : "Brelan";
        case 'Carré': return r1 ? `Carré de ${r1}` : "Carré";
        case 'Full':
            if (r1 && r2) return `Full aux ${r1} par les ${r2}`;
            if (r1) return `Full aux ${r1}`;
            return "Full";
        case 'Couleur': return suit ? `Couleur à ${suit}` : "Couleur";
        case 'Suite':
        case 'QuinteFlush':
        case 'QuinteFlushRoyale':
            return r1 ? `${combo} (au ${r1})` : combo;
        default: return combo;
    }
}

// --- INITIALIZATION ---
function initSelects(prefix, isSec = false) {
    const cb = document.getElementById(`${prefix}-combo`);
    const combos = isSec ? COMBOS.slice(1) : COMBOS;
    combos.forEach(c => cb.add(new Option(c, c)));

    const r1 = document.getElementById(`${prefix}-r1`);
    const r2 = document.getElementById(`${prefix}-r2`);

    [r1, r2].forEach(s => {
        s.add(new Option("-", ""));
        RANKS.forEach(r => s.add(new Option(r, r)));
    });

    const su = document.getElementById(`${prefix}-suit`);
    su.add(new Option("-", ""));
    SUITS.forEach(s => su.add(new Option(s, s)));
}

// --- UI INTERACTIONS ---
function updateInputs(n, isUserChange = false) {
    const p = `c${n}`;
    const c = document.getElementById(`${p}-combo`).value;
    const r1 = document.getElementById(`${p}-r1`);
    const r2 = document.getElementById(`${p}-r2`);
    const s = document.getElementById(`${p}-suit`);

    if (isUserChange) {
        r1.value = ""; r2.value = ""; s.value = "";
    }

    r1.style.display = 'none'; r2.style.display = 'none'; s.style.display = 'none';

    if (['Carte', 'Paire', 'Brelan', 'Carré', 'Full', 'Double Paire', 'Suite'].includes(c)) r1.style.display = 'block';
    if (['Double Paire', 'Full'].includes(c)) r2.style.display = 'block';
    if (['Couleur', 'QuinteFlush', 'QuinteFlushRoyale'].includes(c)) s.style.display = 'block';

    if (n === 1) {
        const splitCheck = document.getElementById('check-split');
        if (splitCheck.checked) {
            splitCheck.checked = false;
            toggleSplit();
        }
    }
}

function toggleSplit() {
    const div = document.getElementById('split-inputs');
    const checked = document.getElementById('check-split').checked;

    if (checked) {
        div.style.display = 'block';
        setTimeout(() => div.classList.add('visible'), 10);
    } else {
        div.classList.remove('visible');
        setTimeout(() => div.style.display = 'none', 300);
    }
}

function resetGameInputs() {
    document.getElementById('c1-combo').value = 'Carte';
    document.getElementById('c1-r1').value = '';
    document.getElementById('c1-r2').value = '';
    document.getElementById('c1-suit').value = '';

    document.getElementById('c2-combo').value = 'Carte';
    document.getElementById('c2-r1').value = '';
    document.getElementById('c2-r2').value = '';
    document.getElementById('c2-suit').value = '';

    document.getElementById('check-split').checked = false;
    toggleSplit();
    updateInputs(1);
}

function toggleHand() {
    handHidden = !handHidden;
    render();
}

function toggleChat() {
    const chat = document.getElementById('ui-chat');
    chat.classList.toggle('closed');
    if (!chat.classList.contains('closed')) {
        chat.classList.remove('has-new');
    }
}

function closeModal() { document.getElementById('modal-result').style.display = 'none'; }

// --- ANIMATIONS ---
function restartTimerAnim() {
    const bar = document.getElementById('timer-bar');
    bar.classList.remove('timer-anim');
    void bar.offsetWidth;
    bar.classList.add('timer-anim');
}

function stopTimerAnim() {
    const bar = document.getElementById('timer-bar');
    bar.classList.remove('timer-anim');
    bar.style.width = '0';
}

function triggerModePopup(title, sub, icon, colorClass) {
    const container = document.getElementById('mode-announcement');
    const elTitle = document.getElementById('mode-title');
    const elSub = document.getElementById('mode-sub');
    const elIcon = document.getElementById('mode-icon');

    elTitle.innerText = title;
    elSub.innerText = sub;
    elIcon.innerText = icon;

    container.className = '';
    if (colorClass) container.classList.add(colorClass);

    container.classList.add('active');
    setTimeout(() => {
        container.classList.remove('active');
    }, 2500);
}

function showChatToast(author, message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'chat-toast';

    let shortMsg = message.length > 20 ? message.substring(0, 20) + "..." : message;
    toast.innerHTML = `<span>${author}:</span> ${shortMsg.replace(/</g, "&lt;")}`;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showFeedback(playerIdx, text, color) {
    const container = document.getElementById('players-container');
    const count = gameState.players.length;
    const rx = 35, ry = 25;

    const ang = ((playerIdx - myIdx + count) % count) * (2 * Math.PI / count) + Math.PI / 2;

    let left, top;
    if (playerIdx === myIdx && count > 1) {
        left = 50; top = 80;
    } else {
        left = 50 + rx * Math.cos(ang);
        top = 45 + ry * Math.sin(ang);
    }

    const bubble = document.createElement('div');
    bubble.className = 'feedback-bubble';
    bubble.innerText = text;
    bubble.style.left = left + '%';
    bubble.style.top = top + '%';
    if (color) bubble.style.color = color;

    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 1500);
}

function showEmote(playerIdx, emoteName) {
    const count = gameState.players.length;
    const rx = 35, ry = 25;
    let left, top;

    if (playerIdx === myIdx && count > 1) {
        left = 50; top = 80;
    } else {
        const ang = ((playerIdx - myIdx + count) % count) * (2 * Math.PI / count) + Math.PI / 2;
        left = 50 + rx * Math.cos(ang);
        top = 45 + ry * Math.sin(ang);
    }

    const img = document.createElement('img');
    img.className = 'floating-emoji';
    img.src = 'assets/emotes/' + emoteName + '.png';
    img.style.left = left + '%';
    img.style.top = top + '%';

    document.body.appendChild(img);
    setTimeout(() => img.remove(), 2000);
}

// --- RENDER FUNCTIONS ---
function render() {
    // 1. PLAYERS
    const cont = document.getElementById('players-container');
    cont.innerHTML = '';
    const count = gameState.players.length;
    const rx = 35, ry = 25;

    gameState.players.forEach((p, i) => {
        if (i === myIdx && count > 1) return;

        const el = document.createElement('div');
        const isDanger = (p.quota === 6);
        let classes = 'player';
        if (i === gameState.current_player_idx) classes += ' active';
        if (isDanger) classes += ' danger-mode';

        el.className = classes;

        const ang = ((i - myIdx + count) % count) * (2 * Math.PI / count) + Math.PI / 2;
        el.style.left = (50 + rx * Math.cos(ang)) + '%';
        el.style.top = (45 + ry * Math.sin(ang)) + '%';
        el.style.transform = 'translate(-50%, -50%)';

        if (i === myIdx) {
            if (isDanger) document.body.classList.add('in-danger');
            else document.body.classList.remove('in-danger');
        }

        let cardsHtml = '';
        if (p.eliminated) {
            cardsHtml = '<div class="info-tag" style="color:#e74c3c; font-weight:bold; background:rgba(0,0,0,0.8);">💀 ÉLIMINÉ</div>';
        } else {
            cardsHtml = '<div class="opponent-hand">';
            for (let k = 0; k < p.card_count; k++) {
                cardsHtml += '<img src="assets/cards/back.png" class="mini-card">';
            }
            cardsHtml += '</div>';
        }

        el.innerHTML = `
            <div class="avatar">
                ${p.name.substring(0, 2)}
                ${i === gameState.last_declarer_idx ? '<span style="position:absolute; top:-15px; right:-10px; font-size:1.5rem">📢</span>' : ''}
            </div>
            <div style="font-size:0.9rem; font-weight:bold; margin-top:5px; text-shadow:0 1px 2px black; color: white;">
                ${p.name}
            </div>
            ${cardsHtml}
        `;
        cont.appendChild(el);
    });

    // 2. MY HAND
    const handDiv = document.getElementById('my-cards');
    handDiv.innerHTML = '';

    gameState.my_hand.forEach((c, index) => {
        const img = document.createElement('img');
        img.src = handHidden ? 'assets/cards/back.png' : getSrc(c[0], c[1]);
        img.style.animationDelay = `${index * 0.05}s`;
        handDiv.appendChild(img);
    });

    // 3. CLAIM
    renderClaim(gameState.claim);

    // 4. CONTROLS
    const isMyTurn = (myIdx === gameState.current_player_idx);
    const controlsPanel = document.getElementById('controls');

    controlsPanel.style.opacity = isMyTurn ? '1' : '0.5';
    controlsPanel.style.pointerEvents = isMyTurn ? 'all' : 'none';

    const btnCall = document.querySelector('.btn-call');

    if (!gameState.claim) {
        btnCall.disabled = true;
        btnCall.style.opacity = "0.5";
        btnCall.style.cursor = "not-allowed";
        btnCall.title = "Impossible au premier tour";
    } else {
        btnCall.disabled = false;
        btnCall.style.opacity = "1";
        btnCall.style.cursor = "pointer";
        btnCall.title = "";
    }

    const currentPlayer = gameState.players[gameState.current_player_idx];
    if (currentPlayer && currentPlayer.quota === 6 && !currentPlayer.eliminated) {
        playSfx('heartbeat');
    }
}

function renderClaim(c) {
    const txt = document.getElementById('claim-text');
    const div = document.getElementById('visual-claim');
    div.innerHTML = '';

    if (!c) {
        txt.innerText = "MANCHE " + (gameState.round || 1);
        return;
    }

    let mainText = getComboText(c.combo, c.rank1, c.rank2, c.suit);
    if (c.sec_combo) {
        const secText = getComboText(c.sec_combo, c.sec_rank1, c.sec_rank2, c.sec_suit);
        mainText += " + " + secText;
    }

    txt.innerText = mainText;

    // Visuals
    const drawList = (list) => {
        list.forEach(card => {
            const img = document.createElement('img');
            img.src = (card.r === 'back') ? 'assets/cards/back.png' : getSrc(card.r, card.s);
            div.appendChild(img);
        });
    };

    const cards1 = generateVisuals(c.combo, c.rank1, c.rank2, c.suit);
    drawList(cards1);

    if (c.sec_combo) {
        const sep = document.createElement('div');
        sep.className = 'separator';
        sep.innerText = '+';
        div.appendChild(sep);

        const cards2 = generateVisuals(c.sec_combo, c.sec_rank1, c.sec_rank2, c.sec_suit);
        drawList(cards2);
    }
}

function generateVisuals(combo, r1, r2, suit) {
    let cards = [];
    const getMixedSuit = (idx) => SUITS[idx % 4];
    const addBack = (n) => { for (let i = 0; i < n; i++) cards.push({ r: 'back' }); };
    const addRank = (r, n, offset = 0) => { for (let i = 0; i < n; i++) cards.push({ r: r, s: suit || getMixedSuit(offset + i) }); };
    const addSuit = (s, n) => {
        const deco = ['A', 'K', 'Q', 'J', '10'];
        for (let i = 0; i < n; i++) cards.push({ r: deco[i], s: s });
    };

    // Special Logic (Suites)
    if (['Suite', 'QuinteFlush', 'QuinteFlushRoyale'].includes(combo)) {
        let targetSuit = suit || '♠';
        if (combo === 'QuinteFlushRoyale') {
            ['10', 'J', 'Q', 'K', 'A'].forEach(r => cards.push({ r: r, s: targetSuit }));
        }
        else {
            if (r1) {
                const endIdx = RANKS.indexOf(r1);
                let indices = [];
                for (let i = 0; i < 5; i++) {
                    let idx = endIdx - i;
                    if (idx < 0) idx = RANKS.length + idx;
                    indices.push(idx);
                }
                indices.reverse();
                indices.forEach(idx => {
                    let r = RANKS[idx];
                    let s = (combo === 'QuinteFlush') ? targetSuit : getMixedSuit(idx);
                    cards.push({ r: r, s: s });
                });
            } else {
                addBack(5);
            }
        }
        return cards;
    }

    if (combo === 'Carte') r1 ? addRank(r1, 1) : addBack(1);
    else if (combo === 'Paire') r1 ? addRank(r1, 2) : addBack(2);
    else if (combo === 'Double Paire') {
        r1 ? addRank(r1, 2, 0) : addBack(2);
        r2 ? addRank(r2, 2, 2) : addBack(2);
    }
    else if (combo === 'Brelan') r1 ? addRank(r1, 3) : addBack(3);
    else if (combo === 'Full') {
        r1 ? addRank(r1, 3, 0) : addBack(3);
        r2 ? addRank(r2, 2, 3) : addBack(2);
    }
    else if (combo === 'Carré') r1 ? addRank(r1, 4) : addBack(4);
    else if (combo === 'Couleur') suit ? addSuit(suit, 5) : addBack(5);
    else addBack(1);

    return cards;
}

function showResult(msg) {
    const m = document.getElementById('modal-result');
    m.style.display = 'flex';
    document.getElementById('res-title').innerText = msg.title;
    document.getElementById('res-desc').innerText = msg.detail;

    const grid = document.getElementById('res-cards');
    const statsEl = document.getElementById('res-stats');
    if (msg.stats && msg.stats.length > 0) {
        statsEl.innerText = msg.stats[0];
    } else {
        statsEl.innerText = "";
    }
    grid.innerHTML = '';

    const cards = msg.all_cards;
    const ranksOrder = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
    const suitsOrder = { '♠': 1, '♥': 2, '♣': 3, '♦': 4 };

    const claim = gameState.claim || {};
    const isSuitBased = ['Couleur', 'QuinteFlush', 'QuinteFlushRoyale'].includes(claim.combo);

    cards.sort((a, b) => {
        const rA = ranksOrder[a[0]];
        const rB = ranksOrder[b[0]];
        const sA = suitsOrder[a[1]];
        const sB = suitsOrder[b[1]];

        if (isSuitBased) {
            if (sA !== sB) return sA - sB;
            return rB - rA;
        } else {
            if (rA !== rB) return rB - rA;
            return sA - sB;
        }
    });

    cards.forEach(c => {
        let img = document.createElement('img');
        img.src = getSrc(c[0], c[1]);
        img.style.animation = "popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) both";
        grid.appendChild(img);
    });
}
