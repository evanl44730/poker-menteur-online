const { RANKS, SUITS, COMBOS, MAX_LIVES } = require('../config/constants');
const Deck = require('./Deck');
const Claim = require('../models/Claim');

// Helper for python's Counter
function getCounts(pool, index) {
    const counts = {};
    for (const card of pool) {
        const key = card[index]; // 0 for rank, 1 for suit
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

class GameEngine {
    constructor() {
        this.players = []; // List of objects { id, name, hand: [], quota: 1, eliminated: false }
        this.gameStarted = false;
        this.currentRound = 0;

        this.currentPlayerIdx = 0;
        this.lastDeclarerIdx = null;

        this.currentClaim = null; // Instance of Claim

        // Game Modes
        this.isBlind = false;
        this.isDoublePenalty = false;
        this.isTimerMode = false;

        this.deck = [];

        // Used in server.js to emit events
        this.eventEmitter = null;
    }

    setEventEmitter(emitFn) {
        this.eventEmitter = emitFn;
    }

    addPlayer(id, name) {
        if (this.gameStarted) return false;
        this.players.push({
            id,
            name: name || "Inconnu",
            hand: [],
            quota: 1,
            eliminated: false
        });
        return true;
    }

    removePlayer(id) {
        const idx = this.players.findIndex(p => p.id === id);
        if (idx === -1) return;

        // Logic for handling disconnect during game copied from unregister
        if (this.gameStarted) {
            // If the player who left was before current player, shift index
            if (idx < this.currentPlayerIdx) {
                this.currentPlayerIdx--;
            } else if (idx === this.currentPlayerIdx) {
                if (this.currentPlayerIdx >= this.players.length - 1) {
                    this.currentPlayerIdx = 0;
                }
                // Note: Actual logic to skip eliminated player handles the rest
            }

            if (this.lastDeclarerIdx !== null) {
                if (idx < this.lastDeclarerIdx) {
                    this.lastDeclarerIdx--;
                } else if (idx === this.lastDeclarerIdx) {
                    this.lastDeclarerIdx = null;
                    this.currentClaim = null;
                }
            }
        }

        this.players.splice(idx, 1);

        // Ensure index safety
        if (this.currentPlayerIdx >= this.players.length) this.currentPlayerIdx = 0;
    }

    getActivePlayers() {
        return this.players.filter(p => !p.eliminated);
    }

    startNewRound() {
        // Cleanup ghosts (players named Inconnu)
        this.players = this.players.filter(p => p.name !== "Inconnu");

        // Modes determination
        const rand = Math.random();
        this.isBlind = (rand < 0.05);
        this.isDoublePenalty = (rand > 0.05 && rand < 0.15);
        this.isTimerMode = (!this.isBlind && !this.isDoublePenalty && rand < 0.25);

        this.currentRound++;
        this.currentClaim = null;
        this.lastDeclarerIdx = null;

        // Deck
        this.deck = Deck.shuffle(Deck.create());

        const active = this.getActivePlayers();
        if (active.length <= 1) {
            return { gameOver: true, winner: active.length ? active[0].name : "Personne" };
        }

        // Deal
        for (const p of active) {
            p.hand = [];
            for (let i = 0; i < p.quota; i++) {
                if (this.deck.length) p.hand.push(this.deck.pop());
            }
        }

        // Revolution Logic
        let effect = null;
        let msgLog = null;
        if (!this.isBlind && Math.random() < 0.15 && this.players.length > 1) {
            effect = "REVOLUTION";
            msgLog = "🌪️ RÉVOLUTION ! Les mains ont tourner !";

            // Rotate hands
            const hands = active.map(p => p.hand);
            const rotated = [...hands.slice(1), hands[0]];
            active.forEach((p, i) => {
                p.hand = rotated[i];
            });
        }

        if (this.isDoublePenalty) effect = "DOUBLE_PENALTY";
        else if (this.isTimerMode) {
            effect = "TIMER";
            msgLog = msgLog || "⏳ BLITZ ! 10 secondes pour jouer !";
        }

        this.ensureValidPlayerIndex();

        return { gameOver: false, effect, msgLog };
    }

    ensureValidPlayerIndex() {
        if (!this.players.length) return;
        let attempts = 0;
        while (attempts < this.players.length) {
            if (this.currentPlayerIdx >= this.players.length) this.currentPlayerIdx = 0;
            if (!this.players[this.currentPlayerIdx].eliminated) return;
            this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length;
            attempts++;
        }
    }

    processBid(playerId, claimData) {
        if (this.players[this.currentPlayerIdx].id !== playerId) return { error: "Pas votre tour" };

        const newClaim = new Claim(claimData);

        // Verification logic
        if (this.currentClaim) {
            if (!newClaim.isGreaterThan(this.currentClaim)) {
                return { error: "Enchère insuffisante ! Vous devez monter." };
            }
        }

        this.currentClaim = newClaim;
        this.lastDeclarerIdx = this.currentPlayerIdx;

        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length;
        this.ensureValidPlayerIndex();

        return { success: true };
    }

    processCall(playerIdCaller) {
        if (this.players[this.currentPlayerIdx].id !== playerIdCaller) return { error: "Pas votre tour" };
        if (this.lastDeclarerIdx === null) return { error: "Impossible, personne n'a joué." };

        const result = this.checkTruth();
        const declarer = this.players[this.lastDeclarerIdx];
        const caller = this.players[this.players.findIndex(p => p.id === playerIdCaller)]; // Should match currentplayeridx roughly

        const loser = result.exists ? caller : declarer;

        const damage = this.isDoublePenalty ? 2 : 1;
        loser.quota += damage;

        let msg = `${loser.name} perd une vie !`;
        if (loser.quota > MAX_LIVES) {
            loser.eliminated = true;
            msg += " ÉLIMINÉ !";
        }

        // Update index to loser
        const loserIdx = this.players.indexOf(loser);
        if (loserIdx !== -1) this.currentPlayerIdx = loserIdx;
        else this.currentPlayerIdx = 0;

        this.ensureValidPlayerIndex();

        return {
            type: 'SHOWDOWN',
            is_truth: result.exists,
            detail: msg,
            all_cards: result.allCards,
            stats: result.stats
        };
    }

    // --- LOGIC PORTED FROM PYTHON server.py ---
    checkTruth() {
        // Gather all cards
        let allCards = [];
        for (const p of this.getActivePlayers()) {
            allCards = allCards.extend ? allCards.extend(p.hand) : allCards.concat(p.hand);
        }

        const c = this.currentClaim;
        // Stats
        let stats = [];
        if (c.combo) {
            const targetR = c.rank1 || c.rank2;
            const targetS = c.suit;
            let count = 0;
            let label = "cartes correspondantes";

            if (targetR) {
                count = allCards.filter(card => card[0] === targetR).length;
                label = `cartes au rang ${targetR}`;
            } else if (targetS) {
                count = allCards.filter(card => card[1] === targetS).length;
                label = `cartes à ${targetS}`;
            }
            if (targetR || targetS) {
                stats.push(`Il y avait exactement ${count} ${label} sur la table.`);
            }
        }

        const { valid: ok1, pool: remPool } = this.checkHandInPool(c.combo, c.rank1, c.rank2, c.suit, allCards);

        if (!ok1) return { exists: false, allCards, stats };

        if (c.sec_combo) {
            const { valid: ok2 } = this.checkHandInPool(c.sec_combo, c.sec_rank1, c.sec_rank2, c.sec_suit, remPool);
            return { exists: ok2, allCards, stats };
        }

        return { exists: true, allCards, stats };
    }

    checkHandInPool(combo, rank1, rank2, suit, availableCards) {
        let pool = [...availableCards]; // Copy
        const rankMap = {};
        RANKS.forEach((r, i) => rankMap[r] = i);

        // -- Helpers --
        const removeIndices = (indices) => {
            // Sort descending to remove correctly
            const sorted = [...indices].sort((a, b) => b - a);
            for (const idx of sorted) {
                pool.splice(idx, 1);
            }
        };

        const remove = (r = null, s = null, count = 1) => {
            const foundIndices = [];
            for (let i = 0; i < pool.length; i++) {
                if (foundIndices.length < count) {
                    const c = pool[i];
                    const matchR = (r === null) || (c[0] === r);
                    const matchS = (s === null) || (c[1] === s);
                    if (matchR && matchS) foundIndices.push(i);
                }
            }
            if (foundIndices.length === count) {
                removeIndices(foundIndices);
                return true;
            }
            return false;
        };

        const findSequence = (cardsSubset, length = 5, isRoyal = false) => {
            const mapped = cardsSubset.map((c, i) => ({
                val: rankMap[c[0]],
                suit: c[1],
                originalIdx: i
            })).sort((a, b) => a.val - b.val);

            const uniqueVals = [...new Set(mapped.map(m => m.val))].sort((a, b) => a - b);
            let foundVals = [];

            // 1. Standard
            for (let i = 0; i <= uniqueVals.length - length; i++) {
                const subset = uniqueVals.slice(i, i + length);
                if (subset[subset.length - 1] - subset[0] === length - 1) {
                    if (isRoyal && subset[subset.length - 1] !== 12) continue; // Must end with Ace (12)
                    foundVals = subset;
                    break;
                }
            }

            // 2. Ace Low (A, 2, 3, 4, 5) => (12, 0, 1, 2, 3)
            if (!foundVals.length && !isRoyal) {
                const target = [0, 1, 2, 3, 12];
                const setVals = new Set(uniqueVals);
                if (target.every(v => setVals.has(v))) {
                    foundVals = target;
                }
            }

            if (foundVals.length) {
                const indicesToRm = [];
                for (const val of foundVals) {
                    const m = mapped.find(m => m.val === val);
                    if (m) indicesToRm.push(m.originalIdx);
                }
                return indicesToRm;
            }
            return null;
        };

        // -- Logic --
        if (combo === 'Carte') {
            return { valid: remove(rank1, null, 1), pool };
        }
        else if (combo === 'Paire') {
            if (rank1) return { valid: remove(rank1, null, 2), pool };
            const counts = getCounts(pool, 0); // Counts by rank
            for (const [r, c] of Object.entries(counts)) {
                if (c >= 2) return { valid: remove(r, null, 2), pool };
            }
            return { valid: false, pool };
        }
        else if (combo === 'Double Paire') {
            if (rank1 && rank2) {
                if (remove(rank1, null, 2)) {
                    // Need logic to save pool if second fails? 
                    // The python code returns remove() which modifies pool in place. 
                    // We need to be careful. In JS remove() modifies pool too thanks to closure in Python, here direct access.
                    // Yes, remove() modifies 'pool' directly.
                    return { valid: remove(rank2, null, 2), pool };
                }
                return { valid: false, pool };
            } else {
                const counts = getCounts(pool, 0);
                const pairs = Object.keys(counts).filter(r => counts[r] >= 2);
                if (pairs.length >= 2) {
                    remove(pairs[0], null, 2);
                    remove(pairs[1], null, 2);
                    return { valid: true, pool };
                }
                return { valid: false, pool };
            }
        }
        else if (combo === 'Brelan') {
            if (rank1) return { valid: remove(rank1, null, 3), pool };
            const counts = getCounts(pool, 0);
            for (const [r, c] of Object.entries(counts)) {
                if (c >= 3) return { valid: remove(r, null, 3), pool };
            }
            return { valid: false, pool };
        }
        else if (combo === 'Carré') {
            if (rank1) return { valid: remove(rank1, null, 4), pool };
            const counts = getCounts(pool, 0);
            for (const [r, c] of Object.entries(counts)) {
                if (c >= 4) return { valid: remove(r, null, 4), pool };
            }
            return { valid: false, pool };
        }
        else if (combo === 'Full') {
            const counts = getCounts(pool, 0);
            const trips = Object.keys(counts).filter(r => counts[r] >= 3);

            let targetTrip = rank1;

            if (targetTrip) {
                if (!remove(targetTrip, null, 3)) return { valid: false, pool };
            } else {
                if (!trips.length) return { valid: false, pool };
                targetTrip = trips[0];
                remove(targetTrip, null, 3);
            }

            // Check Pair
            let targetPair = rank2;
            if (targetPair) {
                if (!remove(targetPair, null, 2)) return { valid: false, pool };
            } else {
                const remCounts = getCounts(pool, 0);
                const pairs = Object.keys(remCounts).filter(r => remCounts[r] >= 2);
                if (!pairs.length) return { valid: false, pool };
                remove(pairs[0], null, 2);
            }
            return { valid: true, pool };
        }
        else if (combo === 'Couleur') {
            if (suit) return { valid: remove(null, suit, 5), pool };
            const counts = getCounts(pool, 1); // Counts by suit
            for (const [s, c] of Object.entries(counts)) {
                if (c >= 5) return { valid: remove(null, s, 5), pool };
            }
            return { valid: false, pool };
        }
        else if (combo === 'Suite') {
            const indices = findSequence(pool, 5, false);
            if (indices) {
                removeIndices(indices);
                return { valid: true, pool };
            }
            return { valid: false, pool };
        }
        else if (combo === 'QuinteFlush' || combo === 'QuinteFlushRoyale') {
            const isRoyal = (combo === 'QuinteFlushRoyale');
            const suitsToCheck = suit ? [suit] : [...new Set(pool.map(c => c[1]))];

            for (const s of suitsToCheck) {
                // Get subset with real indices
                const suitedSubset = pool
                    .map((c, i) => ({ card: c, idx: i }))
                    .filter(item => item.card[1] === s);

                const tempInput = suitedSubset.map(item => item.card);
                const indicesInSubset = findSequence(tempInput, 5, isRoyal);

                if (indicesInSubset) {
                    // Map back to real indices
                    const realIndices = indicesInSubset.map(k => suitedSubset[k].idx);
                    removeIndices(realIndices);
                    return { valid: true, pool };
                }
            }
            return { valid: false, pool };
        }

        return { valid: false, pool };
    }
}

module.exports = GameEngine;
