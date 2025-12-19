const SOUNDS = {
    turn: new Audio('assets/sounds/turn.mp3'),
    heartbeat: new Audio('assets/sounds/heart.mp3'),
    revolution: new Audio('assets/sounds/revolution.mp3'),
    blind: new Audio('assets/sounds/blind.mp3'),
    bid: new Audio('assets/sounds/bet.mp3'),
    lie_found: new Audio('assets/sounds/liar.mp3'),
    truth_hurt: new Audio('assets/sounds/truth.mp3'),
    start: new Audio('assets/sounds/cards.mp3'),
    gelo: new Audio('assets/sounds/gelo.mp3'),
    germinal: new Audio('assets/sounds/germinal.mp3'),
    matou: new Audio('assets/sounds/matou.mp3'),
    max: new Audio('assets/sounds/max.mp3'),
    ciliem: new Audio('assets/sounds/ciliem.mp3')
};

const BGM = new Audio('assets/sounds/jazz.mp3');
const WLCM = new Audio('assets/sounds/welcome.mp3');
BGM.loop = true;
BGM.volume = 0.2;

Object.values(SOUNDS).forEach(s => s.volume = 0.5);

function playSfx(key) {
    const original = SOUNDS[key];
    if (original) {
        const clone = original.cloneNode(true);
        clone.volume = original.volume;
        clone.play().catch(e => console.warn("Son bloqué:", key));
    }
}

function unlockAudioContext() {
    Object.values(SOUNDS).forEach(sound => {
        const p = sound.play();
        if (p !== undefined) {
            p.then(_ => { sound.pause(); sound.currentTime = 0; }).catch(e => { });
        }
    });

    BGM.play().catch(e => console.log("Musique bloquée"));
    WLCM.play().catch(e => console.log("Musique bloquée"));
}

function toggleMusic() {
    const btn = document.getElementById('btn-music');
    if (BGM.paused) {
        BGM.play();
        btn.innerText = "🔊";
        btn.style.opacity = "1";
    } else {
        BGM.pause();
        btn.innerText = "🔇";
        btn.style.opacity = "0.5";
    }
}
