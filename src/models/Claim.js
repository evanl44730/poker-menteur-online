const { RANKS, COMBOS, SUITS } = require('../config/constants');

class Claim {
    constructor(data = {}) {
        this.combo = data.combo || null;
        this.rank1 = data.rank1 || null;
        this.rank2 = data.rank2 || null;
        this.suit = data.suit || null;

        this.sec_combo = data.sec_combo || null;
        this.sec_rank1 = data.sec_rank1 || null;
        this.sec_rank2 = data.sec_rank2 || null;
        this.sec_suit = data.sec_suit || null;
    }

    toDict() {
        return {
            combo: this.combo,
            rank1: this.rank1,
            rank2: this.rank2,
            suit: this.suit,
            sec_combo: this.sec_combo,
            sec_rank1: this.sec_rank1,
            sec_rank2: this.sec_rank2,
            sec_suit: this.sec_suit
        };
    }

    toString() {
        const fmt = (c, r1, r2, s) => {
            if (!c) return "";
            let txt = c;
            if (c === 'Full' && r1 && r2) txt += ` aux ${r1} par les ${r2}`;
            else if (r1 && r2) txt += ` ${r1} & ${r2}`;
            else if (r1) txt += ` de ${r1}`;
            else if (s) txt += ` à ${s}`;
            return txt;
        };

        let mainTxt = fmt(this.combo, this.rank1, this.rank2, this.suit);
        if (this.sec_combo) {
            mainTxt += " + " + fmt(this.sec_combo, this.sec_rank1, this.sec_rank2, this.sec_suit);
        }
        return mainTxt;
    }

    _getScoreTuple(cCombo, r1, r2, s) {
        if (!cCombo) return [-1, -1, -1, -1];

        const comboIdx = COMBOS.indexOf(cCombo);

        const valR1 = (r1 && RANKS.includes(r1)) ? RANKS.indexOf(r1) : -1;
        const valR2 = (r2 && RANKS.includes(r2)) ? RANKS.indexOf(r2) : -1;

        let primary = Math.max(valR1, valR2);
        let secondary = Math.min(valR1, valR2);

        if (cCombo === 'Full') {
            primary = valR1;
            secondary = valR2;
        }

        // Bonus spécificité
        const suitScore = s ? 1 : 0;

        return [comboIdx, primary, secondary, suitScore];
    }

    // Compare this claim with another claim
    // Returns true if this claim is strictly greater than otherClaim
    isGreaterThan(otherClaim) {
        if (!otherClaim) return true;

        const s1 = this.getKey();
        const s2 = otherClaim.getKey();

        // Lexicographical comparison of tuples
        // s1 = [[score1], [score2]]

        // Compare first part (main hand)
        if (this._compareTuples(s1[0], s2[0]) > 0) return true;
        if (this._compareTuples(s1[0], s2[0]) < 0) return false;

        // If first part equal, compare second part (split hand)
        if (this._compareTuples(s1[1], s2[1]) > 0) return true;

        return false;
    }

    getKey() {
        const score1 = this._getScoreTuple(this.combo, this.rank1, this.rank2, this.suit);
        const score2 = this._getScoreTuple(this.sec_combo, this.sec_rank1, this.sec_rank2, this.sec_suit);
        return [score1, score2];
    }

    _compareTuples(t1, t2) {
        for (let i = 0; i < 4; i++) {
            if (t1[i] > t2[i]) return 1;
            if (t1[i] < t2[i]) return -1;
        }
        return 0;
    }
}

module.exports = Claim;
