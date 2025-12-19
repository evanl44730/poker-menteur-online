const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const GameEngine = require('./core/GameEngine');

class Server {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        this.game = new GameEngine();
        this.game.setEventEmitter((evt, data) => this.io.emit(evt, data));

        this.configureRoutes();
        this.configureSockets();
    }

    configureRoutes() {
        // Serve static files from public directory
        this.app.use(express.static(path.join(__dirname, '../public')));

        // Default route
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });
    }

    configureSockets() {
        this.io.on('connection', (socket) => {
            console.log('New client connected:', socket.id);

            // Initial data
            socket.playerData = { name: "Inconnu", id: socket.id };
            this.game.addPlayer(socket.id, "Inconnu");

            // Handle Login
            socket.on('LOGIN', (data) => {
                const p = this.game.players.find(p => p.id === socket.id);
                if (p) {
                    p.name = data.name || "Joueur";
                    socket.playerData.name = p.name;
                    this.broadcastLobby();
                }
            });

            // Handle Start Game
            socket.on('START_GAME', () => {
                if (!this.game.gameStarted) {
                    this.game.gameStarted = true;
                    this.startNewRound();
                }
            });

            // Handle Chat
            socket.on('CHAT', (data) => {
                const content = data.content;
                if (content && content.trim()) {
                    this.io.emit('CHAT_MSG', {
                        type: 'CHAT_MSG',
                        author: socket.playerData.name,
                        text: content
                    });
                }
            });

            // Handle Emotes
            socket.on('EMOTE', (data) => {
                const pIdx = this.game.players.findIndex(p => p.id === socket.id);
                if (pIdx !== -1) {
                    this.io.emit('EMOTE', {
                        type: 'EMOTE',
                        idx: pIdx,
                        content: data.content
                    });
                }
            });

            // Handle Bid
            socket.on('BID', (data) => {
                if (!this.game.gameStarted) return;
                const result = this.game.processBid(socket.id, data.claim);
                if (result.error) {
                    socket.emit('ERROR', { type: 'ERROR', msg: result.error });
                } else {
                    this.broadcastGameState(`a enchéri: ${this.game.currentClaim.toString()}`);
                    this.manageTimer();
                }
            });

            // Handle Call (Menteur)
            socket.on('CALL', () => {
                if (!this.game.gameStarted) return;

                // Stop timer
                if (this.timerTimeout) clearTimeout(this.timerTimeout);

                const result = this.game.processCall(socket.id);
                if (result.error) {
                    socket.emit('ERROR', { type: 'ERROR', msg: result.error });
                } else {
                    // Send Showdown
                    this.io.emit('SHOWDOWN', result);
                    this.broadcastGameState(result.detail); // Update state to show outcome

                    // Delay new round
                    setTimeout(() => {
                        this.startNewRound();
                    }, 6000);
                }
            });

            // Handle Disconnect
            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
                this.game.removePlayer(socket.id);

                if (this.game.gameStarted) {
                    const active = this.game.getActivePlayers();
                    if (active.length < 2) {
                        this.io.emit('GAME_OVER', { type: 'GAME_OVER', winner: active[0] ? active[0].name : "Personne" });
                        this.game.gameStarted = false;
                        this.game.currentRound = 0;
                        this.broadcastLobby();
                    } else {
                        this.broadcastGameState(`${socket.playerData.name} a quitté.`);
                    }
                } else {
                    this.broadcastLobby();
                }
            });
        });
    }

    startNewRound() {
        const res = this.game.startNewRound();
        if (res.gameOver) {
            this.io.emit('GAME_OVER', { type: 'GAME_OVER', winner: res.winner });
            this.game.gameStarted = false;
            return;
        }

        this.broadcastGameState(res.msgLog, true, res.effect);
        this.manageTimer();
    }

    manageTimer() {
        if (this.timerTimeout) clearTimeout(this.timerTimeout);

        if (this.game.isTimerMode && this.game.gameStarted) {
            const currentPlayerIdx = this.game.currentPlayerIdx;
            const currentPlayer = this.game.players[currentPlayerIdx];

            // 10.5 seconds timeout
            this.timerTimeout = setTimeout(() => {
                // Check if still same turn
                if (this.game.currentPlayerIdx === currentPlayerIdx && this.game.gameStarted) {
                    // Time out logic
                    currentPlayer.quota += 1;
                    let msg = `${currentPlayer.name} a été trop lent !`;
                    if (currentPlayer.quota > 6) {
                        currentPlayer.eliminated = true;
                        msg += " ÉLIMINÉ !";
                    }

                    this.io.emit('SHOWDOWN', {
                        type: 'SHOWDOWN',
                        title: "TEMPS ÉCOULÉ !",
                        is_truth: false,
                        detail: msg,
                        all_cards: [],
                        stats: ["Le sablier ne pardonne pas."]
                    });

                    this.game.ensureValidPlayerIndex();
                    setTimeout(() => this.startNewRound(), 4000);
                }
            }, 10500);
        }
    }

    broadcastLobby() {
        this.io.emit('LOBBY_UPDATE', {
            type: 'LOBBY_UPDATE',
            count: this.game.players.length,
            ready: this.game.players.length >= 2
        });
    }

    broadcastGameState(logMsg = null, newRound = false, extraEffect = null) {
        // We need to send specific state to each player (hiding hands)
        const playersPublic = this.game.players.map(p => ({
            name: p.name,
            card_count: p.hand.length,
            eliminated: p.eliminated,
            quota: p.quota
        }));

        this.io.fetchSockets().then(sockets => {
            for (const socket of sockets) {
                const pIdx = this.game.players.findIndex(p => p.id === socket.id);
                const p = this.game.players[pIdx];
                if (!p) continue; // Should not happen

                const state = {
                    type: 'STATE_UPDATE',
                    round: this.game.currentRound,
                    effect: extraEffect,
                    is_blind: this.game.isBlind,
                    is_timer_mode: this.game.isTimerMode,
                    is_double_penalty: this.game.isDoublePenalty,
                    current_player_idx: this.game.currentPlayerIdx,
                    last_declarer_idx: this.game.lastDeclarerIdx,
                    claim: this.game.currentClaim ? this.game.currentClaim.toDict() : null,
                    players: playersPublic,
                    my_hand: p.hand,
                    my_idx: pIdx,
                    log: logMsg,
                    new_round: newRound
                };
                socket.emit('STATE_UPDATE', state);
            }
        });
    }

    listen(port) {
        this.server.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    }
}

module.exports = new Server();
