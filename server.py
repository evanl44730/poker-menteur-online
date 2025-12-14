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

    def _get_score_tuple(self, c_combo, r1, r2, s):
        """ Calcule un score numérique pour comparer les enchères. """
        if not c_combo: return (-1, -1, -1, -1)
        
        try: combo_idx = COMBOS.index(c_combo)
        except: combo_idx = -1
        
        # Valeur des cartes (-1 si non spécifié)
        val_r1 = RANKS.index(r1) if r1 in RANKS else -1
        val_r2 = RANKS.index(r2) if r2 in RANKS else -1
        
        # Logique de scoring:
        # 1. Type de combo (Brelan > Paire)
        # 2. Valeur Principale (Brelan de Rois > Brelan de Dames > Brelan indéfini)
        # 3. Valeur Secondaire (Full Rois par Dames > Full Rois par 2)
        
        primary = max(val_r1, val_r2)
        secondary = min(val_r1, val_r2)
        
        if c_combo == 'Full':
            primary = val_r1 # La carte du brelan compte en premier
            secondary = val_r2

        return (combo_idx, primary, secondary)

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
        self.clients.remove(websocket)
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

    async def send_game_state(self, new_round=False, msg_log=None):
        clients_list = list(self.clients)
        public_players = [{'name': c.player_data['name'], 'card_count': len(c.player_data['hand']), 
                           'eliminated': c.player_data['eliminated'], 'quota': c.player_data['quota']} for c in clients_list]
        claim_dict = self.current_claim.to_dict() if self.current_claim else None
        
        for i, ws in enumerate(clients_list):
            state = {
                "type": "STATE_UPDATE", "round": self.round_num,
                "current_player_idx": self.current_player_idx, "last_declarer_idx": self.last_declarer_idx,
                "claim": claim_dict, "players": public_players,
                "my_hand": ws.player_data['hand'], "my_idx": i, "log": msg_log, "new_round": new_round
            }
            await self.send_to(ws, state)

    def start_new_round(self):
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
        
        self.check_player_index()
        asyncio.create_task(self.send_game_state(new_round=True))

    def check_player_index(self):
        clients_list = list(self.clients)
        if not clients_list: return
        attempts = 0
        while attempts < len(clients_list):
            if self.current_player_idx >= len(clients_list): self.current_player_idx = 0
            if not clients_list[self.current_player_idx].player_data['eliminated']: return
            self.current_player_idx = (self.current_player_idx + 1) % len(clients_list)
            attempts += 1

    async def handler(self, websocket):
        await self.register(websocket)
        try:
            async for message in websocket:
                data = json.loads(message)
                mtype = data.get('type')
                
                if mtype == 'LOGIN':
                    websocket.player_data['name'] = data.get('name')
                    await self.broadcast_lobby()
                
                elif mtype == 'EMOTE':
                    # CORRECTION : On définit la liste ici pour éviter l'erreur "referenced before assignment"
                    clients_list = list(self.clients) 
                    
                    # On vérifie que le client est bien dans la liste pour éviter un autre crash
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
                    clients_list = list(self.clients)
                    if clients_list[self.current_player_idx] != websocket: continue

                    if mtype == 'BID':
                        c_data = data['claim']
                        new_claim = Claim.from_dict(c_data)
                        
                        # --- VALIDATION HIERARCHIE ---
                        valid = True
                        if self.current_claim:
                             # On compare les tuples de score
                             if not (new_claim.get_key() > self.current_claim.get_key()):
                                 valid = False
                        
                        if valid:
                            self.current_claim = new_claim
                            self.last_declarer_idx = self.current_player_idx
                            self.current_player_idx = (self.current_player_idx + 1) % len(clients_list)
                            self.check_player_index()
                            # On utilise la nouvelle méthode __str__ de Claim
                            await self.send_game_state(msg_log=f"{websocket.player_data['name']}: {new_claim}")
                        else:
                            await self.send_to(websocket, {"type": "ERROR", "msg": "Enchère insuffisante ! Vous devez monter."})

                    elif mtype == 'CALL':
                        exists, all_cards, stats = self.check_truth() # Récupère les stats
                        declarer_ws = clients_list[self.last_declarer_idx]
                        loser_ws = websocket if exists else declarer_ws
                        
                        loser_ws.player_data['quota'] += 1
                        msg = f"{loser_ws.player_data['name']} perd une vie !"
                        if loser_ws.player_data['quota'] > MAX_LIVES:
                            loser_ws.player_data['eliminated'] = True; msg += " ÉLIMINÉ !"
                        
                        await self.broadcast({
                            "type": "SHOWDOWN", 
                            "title": "VÉRITÉ !" if exists else "MENSONGE !", 
                            "is_truth": exists,  # <--- AJOUTEZ CETTE LIGNE (True si vérité, False si mensonge)
                            "detail": msg, 
                            "all_cards": all_cards,
                            "stats": stats
                        })
                        self.current_player_idx = clients_list.index(loser_ws)
                        self.check_player_index()
                        await asyncio.sleep(6)
                        self.start_new_round()

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