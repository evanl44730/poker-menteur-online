import asyncio
import websockets
import json
import random
import os
from collections import Counter

# --- CONFIGURATION ---
RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
SUITS = ['♠', '♥', '♦', '♣']
COMBOS = ['Carte', 'Paire', 'Double Paire', 'Brelan', 'Couleur', 'Suite', 
          'Full', 'Carré', 'QuinteFlush', 'QuinteFlushRoyale']
MAX_LIVES = 6 

class Claim:
    def __init__(self, combo, rank1=None, rank2=None, suit=None, 
                 sec_combo=None, sec_rank1=None, sec_rank2=None, sec_suit=None):
        self.combo = combo
        # On convertit les chaînes vides "" en None pour la logique python
        self.rank1 = rank1 if rank1 else None
        self.rank2 = rank2 if rank2 else None
        self.suit = suit if suit else None
        
        self.sec_combo = sec_combo
        self.sec_rank1 = sec_rank1 if sec_rank1 else None
        self.sec_rank2 = sec_rank2 if sec_rank2 else None
        self.sec_suit = sec_suit if sec_suit else None

    def to_dict(self):
        return self.__dict__
    
    def __str__(self):
        # Petit helper pour formater l'annonce en texte
        def fmt(c, r1, r2, s):
            if not c: return ""
            txt = c
            if c == 'Full' and r1 and r2: txt += f" aux {r1} par les {r2}"
            elif r1 and r2: txt += f" {r1} & {r2}"
            elif r1: txt += f" de {r1}" # ex: Brelan de Rois
            elif s: txt += f" à {s}"
            return txt

        main_txt = fmt(self.combo, self.rank1, self.rank2, self.suit)
        if self.sec_combo:
            main_txt += " + " + fmt(self.sec_combo, self.sec_rank1, self.sec_rank2, self.sec_suit)
        return main_txt

    @staticmethod
    def from_dict(data):
        if data is None: return None
        return Claim(**data)

    # Dans la classe Claim
    def _get_score_tuple(self, c_combo, r1, r2, s):
        """ Calcule un score numérique pour comparer les enchères. """
        if not c_combo: return (-1, -1, -1, -1)
        
        try: combo_idx = COMBOS.index(c_combo)
        except: combo_idx = -1
        
        # Valeur des cartes (-1 si non spécifié)
        val_r1 = RANKS.index(r1) if r1 in RANKS else -1
        val_r2 = RANKS.index(r2) if r2 in RANKS else -1
        
        # Logique de scoring:
        primary = max(val_r1, val_r2)
        secondary = min(val_r1, val_r2)
        
        if c_combo == 'Full':
            primary = val_r1 
            secondary = val_r2

        # --- NOUVEAU : Bonus de spécificité (Couleur définie > non définie) ---
        # 1 si une couleur est spécifiée, 0 sinon.
        # Cela permet à "Couleur à Pique" de battre "Couleur" (vague).
        suit_score = 1 if s else 0

        return (combo_idx, primary, secondary, suit_score)

    def get_key(self):
        """ Retourne une clé de comparaison (Main 1, Main 2) """
        s1 = self._get_score_tuple(self.combo, self.rank1, self.rank2, self.suit)
        s2 = self._get_score_tuple(self.sec_combo, self.sec_rank1, self.sec_rank2, self.sec_suit)
        return (s1, s2)

class GameServer:
    def __init__(self):
        self.clients = set()
        self.game_started = False
        self.current_player_idx = 0
        self.is_blind = False
        self.is_double_penalty = False
        self.timer_task = None
        self.is_timer_mode = False
        self.last_declarer_idx = None
        self.current_claim = None
        self.round_num = 0
        self.deck = []
        print("Serveur WebSocket prêt sur ws://0.0.0.0:5555")

    def make_deck(self): return [(r, s) for r in RANKS for s in SUITS]

    def check_hand_in_pool(self, combo, rank1, rank2, suit, available_cards):
        """ 
        Vérifie si la combinaison existe dans le pool de cartes.
        Gère les annonces précises (ex: "Brelan de Rois") et vagues (ex: "Brelan").
        """
        pool = list(available_cards) # Copie pour manipulation sans casser l'original
        
        # Mapping pour convertir les rangs en valeurs numériques (0 à 12)
        # Nécessaire pour calculer les suites
        RANK_MAP = {r: i for i, r in enumerate(RANKS)} # 2=0 ... A=12
        
        # --- FONCTIONS UTILITAIRES INTERNES ---

        def remove_indices(indices_to_remove):
            """ Supprime des cartes du pool basées sur une liste d'index """
            nonlocal pool
            # On trie en ordre décroissant pour supprimer sans décaler les index restants
            for index in sorted(indices_to_remove, reverse=True):
                del pool[index]

        def remove(r=None, s=None, count=1):
            """ 
            Tente de trouver et supprimer 'count' cartes correspondant aux critères.
            Si r=None ou s=None, cela agit comme un joker (n'importe quel rang/couleur).
            """
            nonlocal pool
            found_indices = []
            
            for i, c in enumerate(pool):
                if len(found_indices) < count:
                    # Vérifie si la carte correspond (ou si le critère est "n'importe")
                    match_r = (r is None) or (c[0] == r)
                    match_s = (s is None) or (c[1] == s)
                    
                    if match_r and match_s:
                        found_indices.append(i)
            
            # Si on a trouvé le compte exact, on valide et on supprime
            if len(found_indices) == count:
                remove_indices(found_indices)
                return True
            return False

        def find_sequence(cards_subset, length=5, is_royal=False):
            """ Cherche une suite mathématique dans un sous-ensemble de cartes """
            # On crée une liste d'objets pour garder le lien avec l'index original
            mapped = []
            for i, c in enumerate(cards_subset):
                mapped.append({'val': RANK_MAP[c[0]], 'suit': c[1], 'original_idx': i})
            
            # Tri par valeur numérique
            mapped.sort(key=lambda x: x['val'])
            
            unique_vals = sorted(list(set(m['val'] for m in mapped)))
            found_vals = []

            # 1. Vérification Suite Standard (ex: 4,5,6,7,8)
            for i in range(len(unique_vals) - length + 1):
                subset = unique_vals[i : i+length]
                # Si la différence entre le dernier et le premier est (length-1), c'est consécutif
                if subset[-1] - subset[0] == length - 1:
                    if is_royal and subset[-1] != 12: continue # Royale doit finir par As (12)
                    found_vals = subset
                    break
            
            # 2. Vérification Suite As-faible (A,2,3,4,5) -> (12,0,1,2,3)
            if not found_vals and not is_royal:
                # Si on a As(12), 2(0), 3(1), 4(2), 5(3)
                if {0, 1, 2, 3, 12}.issubset(set(unique_vals)):
                    found_vals = [0, 1, 2, 3, 12]

            # Si une suite est trouvée, on récupère les index originaux
            if found_vals:
                indices_to_rm = []
                for val in found_vals:
                    # On cherche la première carte correspondant à cette valeur
                    for m in mapped:
                        if m['val'] == val:
                            indices_to_rm.append(m['original_idx'])
                            break 
                return indices_to_rm
            return None

        # --- LOGIQUE PAR COMBINAISON ---

        if combo == 'Carte':
            # Si rank1 est None, remove prendra n'importe quelle carte (True)
            return remove(r=rank1, count=1), pool
        
        elif combo == 'Paire':
            if rank1: return remove(r=rank1, count=2), pool
            # Recherche vague : n'importe quelle paire
            cnt = Counter([c[0] for c in pool])
            for r, c in cnt.items():
                if c >= 2: return remove(r=r, count=2), pool
            return False, pool

        elif combo == 'Double Paire':
            if rank1 and rank2:
                # Précis
                if remove(r=rank1, count=2):
                    return remove(r=rank2, count=2), pool
                return False, pool
            else:
                # Vague : Trouver 2 paires distinctes
                cnt = Counter([c[0] for c in pool])
                pairs = [r for r, c in cnt.items() if c >= 2]
                if len(pairs) >= 2:
                    remove(r=pairs[0], count=2)
                    remove(r=pairs[1], count=2)
                    return True, pool
                return False, pool

        elif combo == 'Brelan':
            if rank1: return remove(r=rank1, count=3), pool
            cnt = Counter([c[0] for c in pool])
            for r, c in cnt.items():
                if c >= 3: return remove(r=r, count=3), pool
            return False, pool

        elif combo == 'Carré':
            if rank1: return remove(r=rank1, count=4), pool
            cnt = Counter([c[0] for c in pool])
            for r, c in cnt.items():
                if c >= 4: return remove(r=r, count=4), pool
            return False, pool
            
        elif combo == 'Full':
            # Full = Brelan + Paire
            cnt = Counter([c[0] for c in pool])
            trips = [r for r, c in cnt.items() if c >= 3]
            
            target_trip = rank1
            
            # 1. Trouver le Brelan
            if target_trip:
                if not remove(r=target_trip, count=3): return False, pool
            else:
                if not trips: return False, pool
                target_trip = trips[0] # On prend le premier brelan dispo
                remove(r=target_trip, count=3)
            
            # 2. Trouver la Paire (sur le pool restant)
            target_pair = rank2
            if target_pair:
                if not remove(r=target_pair, count=2): return False, pool
            else:
                # Recalculer les comptes sur le pool restant
                cnt_rem = Counter([c[0] for c in pool])
                pairs = [r for r, c in cnt_rem.items() if c >= 2]
                if not pairs: return False, pool
                remove(r=pairs[0], count=2)
                
            return True, pool

        elif combo == 'Couleur':
            if suit: return remove(s=suit, count=5), pool
            # Vague : n'importe quelle couleur
            cnt = Counter([c[1] for c in pool])
            for s, c in cnt.items():
                if c >= 5: return remove(s=s, count=5), pool
            return False, pool

        elif combo == 'Suite':
            # On passe tout le pool à l'algo de détection
            indices = find_sequence(pool)
            if indices:
                remove_indices(indices)
                return True, pool
            return False, pool

        elif combo == 'QuinteFlush' or combo == 'QuinteFlushRoyale':
            is_royal = (combo == 'QuinteFlushRoyale')
            
            # On détermine quelles couleurs tester
            suits_to_check = [suit] if suit else list(set(c[1] for c in pool))
            
            for s in suits_to_check:
                # 1. Isoler les cartes de cette couleur avec leur vrai index
                suited_subset = [] # Liste de tuples (Rank, Suit, RealIndex)
                for i, c in enumerate(pool):
                    if c[1] == s:
                        suited_subset.append((c[0], c[1], i))
                
                # 2. Chercher la suite dans ce sous-ensemble
                # On formate pour find_sequence qui attend [(Rank, Suit)...]
                temp_input = [(x[0], x[1]) for x in suited_subset]
                
                indices_in_subset = find_sequence(temp_input, 5, is_royal)
                
                if indices_in_subset:
                    # 3. Retrouver les index réels du pool principal
                    real_indices = [suited_subset[k][2] for k in indices_in_subset]
                    remove_indices(real_indices)
                    return True, pool
                    
            return False, pool

        # Si combo inconnu
        return False, pool

    def check_truth(self):
        all_cards = []
        for c in self.clients:
            if not c.player_data['eliminated']: all_cards.extend(c.player_data['hand'])
            
        c = self.current_claim
        
        # --- STATS ANALYTIQUES ---
        stats = []
        if c.combo:
            # Compte simple pour feedback (ex: combien de Rois ?)
            target_r = c.rank1 or c.rank2
            target_s = c.suit
            count = 0
            label = "cartes correspondantes"
            
            if target_r: 
                count = sum(1 for card in all_cards if card[0] == target_r)
                label = f"cartes au rang {target_r}"
            elif target_s:
                count = sum(1 for card in all_cards if card[1] == target_s)
                label = f"cartes à {target_s}"
            
            if target_r or target_s:
                stats.append(f"Il y avait exactement {count} {label} sur la table.")

        # --- VERIFICATION ---
        ok1, rem_pool = self.check_hand_in_pool(c.combo, c.rank1, c.rank2, c.suit, all_cards)
        
        if not ok1: return False, all_cards, stats
        
        if c.sec_combo:
            ok2, _ = self.check_hand_in_pool(c.sec_combo, c.sec_rank1, c.sec_rank2, c.sec_suit, rem_pool)
            return ok2, all_cards, stats
            
        return True, all_cards, stats

    # --- SERVER CORE ---
    async def register(self, websocket):
        self.clients.add(websocket)
        websocket.player_data = {'name': "Inconnu", 'hand': [], 'quota': 1, 'eliminated': False}

    async def unregister(self, websocket):
        # 1. Gestion des indices (pour ne pas casser le tour de jeu)
        if self.game_started and websocket in self.clients:
            clients_list = list(self.clients)
            try:
                left_idx = clients_list.index(websocket)
                
                # Ajustement du pointeur du joueur actuel
                if left_idx < self.current_player_idx:
                    self.current_player_idx -= 1
                elif left_idx == self.current_player_idx:
                    if self.current_player_idx >= len(self.clients) - 1:
                        self.current_player_idx = 0

                # Ajustement du pointeur du dernier déclarant
                if self.last_declarer_idx is not None:
                    if left_idx < self.last_declarer_idx:
                        self.last_declarer_idx -= 1
                    elif left_idx == self.last_declarer_idx:
                        self.last_declarer_idx = None
                        self.current_claim = None
                        
            except ValueError:
                pass

        # 2. Suppression définitive du client
        if websocket in self.clients:
            self.clients.remove(websocket)

        # 3. Logique de continuation ou fin de partie
        if self.game_started:
            active_players = [c for c in self.clients if not c.player_data.get('eliminated')]
            
            # Cas A : Il ne reste plus assez de joueurs -> FIN DE PARTIE
            if len(active_players) < 2:
                winner = active_players[0].player_data['name'] if active_players else "Personne"
                await self.broadcast({"type": "GAME_OVER", "winner": winner})
                
                # On réinitialise le jeu
                self.game_started = False
                self.round_num = 0
                self.current_claim = None
                
                # C'est fini, DONC on peut rafraîchir le lobby pour tout le monde
                await self.broadcast_lobby()
            
            # Cas B : La partie continue -> PAS DE LOBBY UPDATE
            else:
                self.check_player_index()
                leaver_name = websocket.player_data.get('name', 'Un joueur')
                # On met juste à jour l'interface de jeu (supprime l'avatar du partant)
                await self.send_game_state(msg_log=f"{leaver_name} a quitté la partie (Abandon).")
        
        else:
            # 4. Si la partie n'avait pas commencé, on met à jour le lobby normalement
            await self.broadcast_lobby()

    async def broadcast_lobby(self):
        await self.broadcast({"type": "LOBBY_UPDATE", "count": len(self.clients), "ready": len(self.clients) >= 2})

    async def broadcast(self, message):
        if not self.clients: return
        msg = json.dumps(message)
        tasks = [client.send(msg) for client in self.clients]
        await asyncio.gather(*tasks)

    async def send_to(self, ws, message):
        try: await ws.send(json.dumps(message))
        except: pass

    async def send_game_state(self, new_round=False, msg_log=None,extra_effect=None):
        clients_list = list(self.clients)
        public_players = [{'name': c.player_data['name'], 'card_count': len(c.player_data['hand']), 
                           'eliminated': c.player_data['eliminated'], 'quota': c.player_data['quota']} for c in clients_list]
        claim_dict = self.current_claim.to_dict() if self.current_claim else None
        
        for i, ws in enumerate(clients_list):
            state = {
                "type": "STATE_UPDATE", "round": self.round_num,
                "effect": extra_effect,
                "is_blind": self.is_blind,
                "is_timer_mode": self.is_timer_mode,
                "is_double_penalty": self.is_double_penalty,
                "current_player_idx": self.current_player_idx, "last_declarer_idx": self.last_declarer_idx,
                "claim": claim_dict, "players": public_players,
                "my_hand": ws.player_data['hand'], "my_idx": i, "log": msg_log, "new_round": new_round
            }
            await self.send_to(ws, state)

    # Dans la classe GameServer :

    def start_new_round(self):
        # --- FIX ANTI-FANTÔME ---
        # On retire manuellement les joueurs qui s'appellent "Inconnu" (ceux bloqués au login)
        # pour éviter qu'ils ne soient inclus dans la partie comme joueurs vides.
        ghosts = [ws for ws in self.clients if ws.player_data.get('name') == "Inconnu"]
        for g in ghosts:
            if g in self.clients:
                self.clients.remove(g)
        # ------------------------
        if self.timer_task: self.timer_task.cancel()
        rand = random.random()
        self.is_blind = (rand < 0.05)
        self.is_double_penalty = (rand > 0.05 and rand < 0.15)
        # 10% de chance pour le mode Timer (si pas d'autre mode)
        self.is_timer_mode = (not self.is_blind and not self.is_double_penalty and rand < 0.25)
        self.round_num += 1; self.current_claim = None; self.last_declarer_idx = None
        self.deck = self.make_deck(); random.shuffle(self.deck)
        
        active = [c for c in self.clients if not c.player_data['eliminated']]
        
        if len(active) <= 1:
            asyncio.create_task(self.broadcast({"type": "GAME_OVER", "winner": active[0].player_data['name'] if active else "Personne"}))
            return

        for ws in active:
            ws.player_data['hand'] = []
            for _ in range(ws.player_data['quota']):
                if self.deck: ws.player_data['hand'].append(self.deck.pop())
        
        is_revolution = False
        
        # 3. On ne tente la Révolution QUE SI le mode Blind n'est PAS actif
        if not self.is_blind:
            # 10% de chance, et il faut au moins 2 joueurs
            is_revolution = (random.random() < 0.15) and (len(self.clients) > 1)
            
        msg_log = None
        effect_name = None
        
        if self.is_double_penalty:
            effect_name = "DOUBLE_PENALTY"
        elif self.is_timer_mode: # <--- NOUVEAU
            effect_name = "TIMER"
            msg_log = "⏳ BLITZ ! 10 secondes pour jouer !"
        
        if is_revolution:
            effect_name="REVOLUTION"
            msg_log = "🌪️ RÉVOLUTION ! Les mains ont tourné !"
            # On décale les mains : Le joueur 1 prend la main du 2, le 2 du 3, etc.
            # On récupère juste les listes de cartes
            hands = [ws.player_data['hand'] for ws in active]
            # On décale la liste de 1 vers la gauche
            rotated_hands = hands[1:] + hands[:1]
            
            # On réattribue
            for i, ws in enumerate(active):
                ws.player_data['hand'] = rotated_hands[i]
        self.check_player_index()
        
        asyncio.create_task(self.send_game_state(new_round=True, msg_log=msg_log, extra_effect=effect_name))

    def check_player_index(self):
        clients_list = list(self.clients)
        if not clients_list: return
        attempts = 0
        while attempts < len(clients_list):
            if self.current_player_idx >= len(clients_list): self.current_player_idx = 0
            if not clients_list[self.current_player_idx].player_data['eliminated']: return
            self.current_player_idx = (self.current_player_idx + 1) % len(clients_list)
            attempts += 1
    
    def reset_timer(self):
        if self.timer_task: self.timer_task.cancel()
        if self.is_timer_mode and self.game_started:
            # On lance le compte à rebours pour le joueur actuel
            self.timer_task = asyncio.create_task(self.run_timer(self.current_player_idx))
            
    async def run_timer(self, player_idx):
        try:
            # Attendre 7 secondes (+ petite marge réseau)
            await asyncio.sleep(10.5) 
            
            # Vérification : est-ce toujours le tour de ce joueur ?
            if self.current_player_idx == player_idx and self.game_started:
                # TEMPS ÉCOULÉ !
                clients_list = list(self.clients)
                loser_ws = clients_list[player_idx]
                
                loser_ws.player_data['quota'] += 1
                msg = f"⏳ {loser_ws.player_data['name']} a été trop lent !"
                
                if loser_ws.player_data['quota'] > MAX_LIVES:
                    loser_ws.player_data['eliminated'] = True
                    msg += " ÉLIMINÉ !"
                
                # On envoie un SHOWDOWN spécial "TIMEOUT"
                await self.broadcast({
                    "type": "SHOWDOWN",
                    "title": "TEMPS ÉCOULÉ !",
                    "is_truth": False, # Son d'échec
                    "detail": msg,
                    "all_cards": [], # On ne montre pas forcément les cartes sur un timeout
                    "stats": ["Le sablier ne pardonne pas."]
                })
                
                self.check_player_index()
                await asyncio.sleep(4)
                self.start_new_round()
                
        except asyncio.CancelledError:
            pass # Le timer a été annulé car le joueur a joué, tout va bien.

    async def handler(self, websocket):
        # --- MODIFICATION : Blocage si la partie est déjà lancée ---
        if self.game_started:
            await self.send_to(websocket, {"type": "ERROR", "msg": "Une partie est déjà en cours. Impossible de rejoindre."})
            return # Coupe la connexion immédiatement
        # -----------------------------------------------------------

        await self.register(websocket)
        try:
            async for message in websocket:
                data = json.loads(message)
                mtype = data.get('type')
                
                if mtype == 'LOGIN':
                    websocket.player_data['name'] = data.get('name')
                    await self.broadcast_lobby()
                
                elif mtype == 'CHAT':
                    p_name = websocket.player_data.get('name', 'Inconnu')
                    msg_content = data.get('content', '')
                    # On évite les messages vides
                    if msg_content.strip():
                        await self.broadcast({"type": "CHAT_MSG", "author": p_name, "text": msg_content})
                
                elif mtype == 'EMOTE':
                    clients_list = list(self.clients) 
                    if websocket in clients_list:
                        await self.broadcast({
                            "type": "EMOTE", 
                            "idx": clients_list.index(websocket), 
                            "content": data.get('content')
                        })

                elif mtype == 'START_GAME':
                    if not self.game_started:
                        self.game_started = True
                        self.start_new_round()

                elif self.game_started:
                    # On régénère la liste car l'ordre peut changer après un départ
                    clients_list = list(self.clients)
                    
                    # Sécurité : si l'index dépasse après un bug rare
                    if self.current_player_idx >= len(clients_list):
                        self.current_player_idx = 0
                        
                    if clients_list[self.current_player_idx] != websocket: continue

                    if mtype == 'BID':
                        c_data = data['claim']
                        new_claim = Claim.from_dict(c_data)
                        
                        valid = True
                        if self.current_claim:
                             if not (new_claim.get_key() > self.current_claim.get_key()):
                                 valid = False
                        
                        if valid:
                            self.current_claim = new_claim
                            self.last_declarer_idx = self.current_player_idx
                            self.current_player_idx = (self.current_player_idx + 1) % len(clients_list)
                            self.check_player_index()
                            await self.send_game_state(msg_log=f"{websocket.player_data['name']}: {new_claim}")
                            if self.is_timer_mode: self.reset_timer()
                        else:
                            await self.send_to(websocket, {"type": "ERROR", "msg": "Enchère insuffisante ! Vous devez monter."})

                    elif mtype == 'CALL':
                        # Sécurité : Impossible d'appeler Menteur si personne n'a joué (cas où le déclarant quitte)
                        if self.timer_task: self.timer_task.cancel()
                        if self.last_declarer_idx is None:
                            await self.send_to(websocket, {"type": "ERROR", "msg": "Impossible, le joueur précédent est parti. Veuillez enchérir."})
                            continue

                        exists, all_cards, stats = self.check_truth()
                        declarer_ws = clients_list[self.last_declarer_idx]
                        loser_ws = websocket if exists else declarer_ws
                        
                        damage = 2 if self.is_double_penalty else 1
                        loser_ws.player_data['quota'] += damage
                       
                        msg = f"{loser_ws.player_data['name']} perd une vie !"
                        if loser_ws.player_data['quota'] > MAX_LIVES:
                            loser_ws.player_data['eliminated'] = True; msg += " ÉLIMINÉ !"
                        
                        await self.broadcast({
                            "type": "SHOWDOWN", 
                            "title": "VÉRITÉ !" if exists else "MENSONGE !", 
                            "is_truth": exists,
                            "detail": msg, 
                            "all_cards": all_cards,
                            "stats": stats
                        })
                        
                        # Mise à jour de l'index vers le perdant
                        try:
                            self.current_player_idx = clients_list.index(loser_ws)
                        except ValueError:
                            self.current_player_idx = 0 # Fallback si le perdant quitte pile à ce moment
                            
                        self.check_player_index()
                        await asyncio.sleep(6)
                        self.start_new_round()
                        
                    elif mtype == 'SPOT_ON':
                         if self.timer_task: self.timer_task.cancel() # <--- STOP TIMER
                         # ... (Reste logique SPOT_ON inchangé) ...

        except Exception as e: print(f"Erreur: {e}")
        finally: await self.unregister(websocket)

async def main():
    # Render nous donne le port via la variable d'environnement "PORT"
    # Si elle n'existe pas (en local), on utilise 5555
    port = int(os.environ.get("PORT", 5555))
    print(f"Démarrage du serveur sur le port {port}")

    async with websockets.serve(GameServer().handler, "0.0.0.0", port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())

