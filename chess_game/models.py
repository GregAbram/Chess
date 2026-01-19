from django.db import models
from django.conf import settings
from django.contrib.auth.models import AbstractUser
import random


class CustomUser(AbstractUser):
    """Extend Django's AbstractUser so additional fields can be stored alongside the user."""
    bio = models.TextField(blank=True)
    # `game` FK removed. Use `Game.white` / `Game.black` and helper
    # properties below to get a user's active games.
    wins = models.IntegerField(default=0)
    losses = models.IntegerField(default=0)
    draws = models.IntegerField(default=0)
    # Per-user `white_or_black` moved to game-level logic; use `Game.user_white_or_black(user)`
    # `latest_move` moved to the Game model to centralize move state.
    friends = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='friend_of')
    def __str__(self):
        return self.username
    def __repr__(self):
        return self.id
    def __eq__(self, other:"CustomUser"):
        return isinstance(other, CustomUser) and self.id == other.id
    def lock_game(self, game: 'Game'):
        """Associate this user with a game if they aren't in a game and the game isn't full."""
        from django.db.models import Q
        # only lock if not already in any active game
        if not Game.objects.filter(models.Q(white=self) | models.Q(black=self)).exists() and not game.is_full():
            game.add_player_random(self)
            # `add_player_random` will add the user to the game; no per-user slot is stored
            # persist any user-level changes if needed elsewhere
            game.set_up_player(self)

    @property
    def games(self):
        """Return a list of Game instances where this user is white or black."""
        from django.db.models import Q
        return list(Game.objects.filter(Q(white=self) | Q(black=self)))

    def primary_game(self):
        """Return the first active game for this user or None."""
        gs = self.games
        return gs[0] if gs else None
    
    def opponents(self):
        """Return a list of CustomUser instances who are this user's opponents in active games."""
        opps = []
        for game in self.games:
            opp = game.opponent(self)
            if opp:
                opps.append(opp)
        return opps
    
    def add_friend(self, friend: 'CustomUser'):
        """Add `friend` to this user's friends list."""
        if friend != self and not self.friends.filter(id=friend.id).exists():
            self.friends.add(friend)
            friend.friends.add(self)  # Ensure bidirectional friendship

    def remove_friend(self, friend: 'CustomUser'):
        """Remove `friend` from this user's friends list."""
        if self.friends.filter(id=friend.id).exists():
            self.friends.remove(friend)
            friend.friends.remove(self)  # Ensure bidirectional removal

class Game(models.Model):
    """A chess game between two players."""
    # Start with two empty player slots (nullable). Use SET_NULL so deleting a user
    # frees the slot instead of deleting the game.
    white = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='games_as_white',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    black = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='games_as_black',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    hidden = models.BooleanField(default=False) #If true, game won't show up in open games list.
    waiting_for_specific_user = models.BooleanField(default=False) #If true, game won't show up in open games list.
    spec_opponent_username = models.CharField(max_length=150, blank=True) #If waiting_for_specific_user is true, this stores their username.
    move_list = models.JSONField(default=list, blank=True)
    white_turn = models.BooleanField(default=True) # True if it's white's turn, False if black's turn
    over = models.BooleanField(default=False) #Stores if the game is over
    #variable to store the backrow for chess360
    back_row_360 = models.JSONField(default=list, blank=True)
    in_game = models.BooleanField(default=False) #Stores if the game is underway.
    # Rematch tracking fields: store whether each player requested a rematch
    rematch_white_requested = models.BooleanField(default=False)
    rematch_black_requested = models.BooleanField(default=False)
    # If a rematch pair was created, store the new game id so clients can redirect
    rematch_new_game_id = models.IntegerField(null=True, blank=True)
    last_seen_move = models.CharField(max_length=5, blank=True) #Stores last move seen.
    latest_move = models.CharField(max_length=5, blank=True)  # latest move by active player
    # Result fields to expose final outcome to clients
    result_type = models.CharField(max_length=10, null=True, blank=True)  # 'win' or 'draw'
    result_winner_id = models.IntegerField(null=True, blank=True)
    result_draw_reason = models.CharField(max_length=32, null=True, blank=True)
    def __str__(self):
        white_name = self.white.username if self.white else "None"
        black_name = self.black.username if self.black else "None"
        return f"Game {self.id}: White: {white_name}, Black: {black_name}"

    def opponent(self, user: CustomUser):
        """Return the opponent of a given user."""
        if user == self.white:
            return self.black
        elif user == self.black:
            return self.white
        else:
            return None

    def is_full(self):
        return self.player_count() == 2

    def get_absolute_url(self):
        return f"/games/{self.id}/"

    def players(self):
        """Return a tuple (white, black) where each element is a User or None."""
        return (self.white, self.black)

    def add_player_random(self, user: CustomUser):
        """Add `user` to a random available slot (white or black).

        Raises ValueError if full.
        """
        if self.is_full():
            raise ValueError('Cannot add player: game is full')
        self.set_up_player(user)
        available = []
        if self.white is None:
            available.append('white')
        if self.black is None:
            available.append('black')
        slot = random.choice(available)
        if slot == 'white':
            self.white = user
        else:
            self.black = user
        # Do not write per-user slot; derive slot from `white`/`black` fields on Game
        # Ensure the game record persists whichever slot was filled
        self.save(update_fields=['white', 'black'])

    def add_move(self, move: str):
        """Add a move to the move list, swap turns and save."""
        if (self.white == None) or (self.black == None):
            raise ValueError('Cannot add move: game does not have two players')
        self.move_list.append(move)
        # Persist move; clients determine active player from `white_turn`
        self.save(update_fields=['move_list'])
        # Do not track per-user `active` flag; clients should determine
        # active player by inspecting `Game.white_turn` or calling
        # `game.is_player_turn(user)`.
        # record the latest move on the game and flip turn
        self.white_turn = not self.white_turn
        self.latest_move = move
        self.save(update_fields=['white_turn', 'latest_move'])
    
    def remove_player(self, user: CustomUser):
        """Remove `user` from the game if present."""
        if user is None:
            return
        if self.white == user:
            self.white = None
        elif self.black == user:
            self.black = None
        # No per-user slot to clear; derive slot from `white`/`black` fields on Game
        # Persist whichever slot changed
        self.save(update_fields=['white', 'black'])
        if self.player_count() == 0:
            self.delete()
    
    def winner(self, user: CustomUser):
        """Update win/loss records based on the winner."""
        # Idempotent: if the game has already been marked over, do nothing.
        if getattr(self, 'over', False):
            return
        self.over = True
        self.result_type = 'win'
        self.result_winner_id = getattr(user, 'id', None)
        # Persist outcome and over flag together
        try:
            self.save(update_fields=['over', 'result_type', 'result_winner_id'])
        except Exception:
            # Fallback to full save
            self.save()
        user.wins += 1
        user.save(update_fields=['wins'])
        opponent = self.opponent(user)
        if opponent:
            opponent.losses += 1
            opponent.save(update_fields=['losses'])
        # Do not immediately reset the game here; keep `over=True` so
        # clients can observe the final state and display results.

    def draw(self, reason: str = None):
        """Update draw records for both players and record a reason.

        `reason` should be one of: '50-move', 'threefold', 'no-legal-moves', or None.
        """
        # Idempotent: if already marked over, do nothing
        if getattr(self, 'over', False):
            return
        self.over = True
        self.result_type = 'draw'
        self.result_winner_id = None
        self.result_draw_reason = reason
        try:
            self.save(update_fields=['over', 'result_type', 'result_winner_id', 'result_draw_reason'])
        except Exception:
            self.save()
        for player in [self.white, self.black]:
            if player:
                player.draws += 1
                player.save(update_fields=['draws'])
        # Keep the game record in the 'over' state so clients can read it.

    def reset_game(self):
        """Reset the game to initial state."""
        self.move_list = []
        self.white_turn = True
        self.over = False
        self.last_seen_move = ''
        self.save(update_fields=['move_list', 'white_turn', 'over', 'last_seen_move'])
        # Remove players if present
        for player in [self.white, self.black]:
            if player:
                self.remove_player(player)
    
    def player_left(self, user: CustomUser):
        """Handle a player leaving the game prematurely."""
        if not self.over:
            opponent = self.opponent(user)
            if opponent: #I don't want to punish someone for leaving a game that hasn't started yet
                opponent.wins += 1
                opponent.save(update_fields=['wins'])
                user.losses += 1
                user.save(update_fields=['losses'])
            self.reset_game()

    def is_player_turn(self, user: CustomUser):
        """Return True if it's `user`'s turn to move."""
        # Allow a player to make a move even if the opponent hasn't joined yet.
        # Previously this returned False when the game wasn't full which
        # prevented the first player from making the opening move in a newly
        # created game. Use explicit checks against the user's slot and the
        # current `white_turn` flag.
        if user == self.white and self.white_turn:
            return True
        if user == self.black and not self.white_turn:
            return True
        return False
    
    def set_back_row_360(self, back_row: list):
        """Set the back row for chess360 variant."""
        if len(back_row) != 8:
            raise ValueError('Back row must have exactly 8 pieces')
        self.back_row_360 = back_row
        self.save(update_fields=['back_row_360'])
    
    def get_back_row_360(self):
        """Get the back row for chess360 variant."""
        return self.white.back_row_360 if self.white else []

    def set_up_player(self, user: CustomUser):
        """Set player's info back to default when joining a new game."""
        # No per-user latest_move now; nothing to do here.
        return

    def ensure_consistent_players(self):
        """Ensure game slots and player records are consistent.

        - If `white` and `black` point to the same user, remove the duplicate from
          the `black` slot (prefer keeping `white`).
        - Ensure each player's `game` and `white_or_black` fields match the game.
        This is defensive and helps recover from rare race conditions or
        external DB edits.
        """
        changed = False
        # If both slots reference the same user, clear the black slot.
        if self.white and self.black and self.white.id == self.black.id:
            self.black = None
            changed = True

        # Persist any slot changes first
        if changed:
            self.save(update_fields=['white', 'black'])

        # No per-user `white_or_black` to sync; ensure game slots point to correct users
        # and persist any slot changes already handled above.

    def get_latest_move(self):
        """Return the latest move for the given user."""
        return self.latest_move
    
    def active_player(self):
        """Returns the player whose turn it is."""
        if self.white_turn:
            return self.white
        else:
            return self.black

    def made_move(self):
        """Checks if the active player has made a move that the opponent hasn't seen yet."""
        return self.last_seen_move != self.latest_move

    def update_last_seen_move(self):
        """Update the last seen move for the game based on the given user."""
        if not self.made_move():
            return

        user = self.active_player()
        opponent = self.opponent(user)

        # If opponent exists, append the game's latest move and toggle turn
        if opponent:
            self.add_move(self.latest_move)
            # Record the move as the last-seen move so future checks
            # can accurately detect new moves.
            try:
                self.last_seen_move = self.latest_move
                self.save(update_fields=['last_seen_move'])
            except Exception:
                pass
            return

        # Opponent is not present: record the move locally and toggle turn.
        self.move_list.append(self.latest_move)
        self.white_turn = not self.white_turn
        # Persist move and turn, and record last seen move
        self.last_seen_move = self.latest_move
        self.save(update_fields=['move_list', 'white_turn', 'last_seen_move'])
    
    def make_move(self, userid:int, move: str):
        """Make a move for the active player."""
        if not self.is_full():
            raise ValueError('Cannot make move: game does not have two players')
        user = self.active_player()
        if user is None or user.id != userid:
            raise ValueError('Cannot make move: not this user\'s turn')
        # Record the move on the game and let game logic apply it
        self.latest_move = move
        self.save(update_fields=['latest_move'])
        self.update_last_seen_move()
    
    def player_count(self):
        """Return the number of players currently in the game."""
        count = 0
        if self.white is not None:
            count += 1
        if self.black is not None:
            count += 1
        return count
    
    def user_white_or_black(self, user: CustomUser):
        """Return 'white', 'black', or '' depending on user's slot in this game."""
        if user == self.white:
            return 'white'
        elif user == self.black:
            return 'black'
        else:
            return ''
        
    def ask_if_move_made(self, user: CustomUser):
        """Return True if the opponent has made a move that `user` hasn't seen yet."""
        if not self.is_full() or self.active_player() == self.opponent(user) or self.opponent(user) is None:
            return False
        return self.last_seen_move != self.latest_move
    
    def white_full(self):
        """Return True if white player slot is filled."""
        return self.white is not None
    
    def black_full(self):
        """Return True if black player slot is filled."""
        return self.black is not None