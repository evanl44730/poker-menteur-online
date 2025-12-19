const { RANKS, SUITS } = require('../config/constants');

class Deck {
    static create() {
        const deck = [];
        for (const r of RANKS) {
            for (const s of SUITS) {
                deck.push([r, s]);
            }
        }
        return deck;
    }

    static shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }
}

module.exports = Deck;
