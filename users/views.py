from django.http import HttpResponse, HttpResponseRedirect, request
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST
from django.contrib import messages
from django.contrib.auth import authenticate, login
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth import get_user_model
User = get_user_model()
from django.db.models import Q
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

def index(request):
    return render(request, 'index.html')


def login_page(request):
    msgs = []
    if (request.method == "POST"):
        username = request.POST["username"]
        password = request.POST["password"]
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return redirect('home')
        else:
            msgs = ["Invalid credentials."]
    return render(request, 'login_page.html', {'messages': msgs})

def register_page(request):
    if (request.method == "POST"):
        firstName = request.POST["firstName"]
        lastName = request.POST["lastName"]
        username = request.POST["username"]
        email = request.POST["email"]
        password = request.POST["password"]
        user  = User.objects.create_user(username=username,email=email,password=password)
        user.first_name=firstName
        user.last_name=lastName
        user.save()
        messages.info(request, "User created.")
    return render(request, 'register_page.html')

@login_required
def game(request, game_id):
    from .models import Game
    try:
        game = Game.objects.get(id=game_id)
        # Don't open if game is full.
        if game.white and game.black and request.user != game.white and request.user != game.black:
            messages.error(request, "This game is already full.")
            return redirect('home')
    except Game.DoesNotExist:
        messages.error(request, "The requested game does not exist or was removed.")
        return redirect('home')
    # If the visiting user is not yet in this game and a slot is open,
    # attempt to atomically claim the open color so clicking an open
    # game will join the user into the available slot.
    user = request.user
    try:
        pg = user.primary_game()
    except Exception:
        pg = None
    # If the user already has a different primary game, redirect to it.
    if pg and pg.id != game.id:
        return redirect('game_view', game_id=pg.id)

    # If the user isn't in any game, try to claim a slot in this game.
    if not pg:
        # Respect games that are waiting for a specific opponent username.
        if (game.white is None or game.black is None) and (not game.waiting_for_specific_user or game.spec_opponent_username == user.username):
            try:
                with transaction.atomic():
                    g = Game.objects.select_for_update().get(pk=game.pk)
                    # Prefer white if available, otherwise black.
                    if g.white is None and g.black != user:
                        g.white = user
                        g.save(update_fields=['white'])
                        print(f"game view: user {user.username} claimed white on game {g.pk}")
                        try:
                            g.ensure_consistent_players()
                        except Exception:
                            pass
                        if g.white and g.black:
                            g.in_game = True
                            g.save(update_fields=['in_game'])
                        return redirect('game_view', game_id=g.id)
                    elif g.black is None and g.white != user:
                        g.black = user
                        g.save(update_fields=['black'])
                        print(f"game view: user {user.username} claimed black on game {g.pk}")
                        try:
                            g.ensure_consistent_players()
                        except Exception:
                            pass
                        if g.white and g.black:
                            g.in_game = True
                            g.save(update_fields=['in_game'])
                        return redirect('game_view', game_id=g.id)
            except Game.DoesNotExist:
                # If the game vanished concurrently, fall through to render which will 404 earlier
                pass
    # Ensure a CSRF token is created and the cookie is set for client-side fetch
    try:
        from django.middleware.csrf import get_token
        get_token(request)
    except Exception:
        pass
    # pass current user's id for client-side use
    return render(request, 'game.html', {'game': game, 'current_user_id': request.user.id})


@login_required
def leave_game(request):
    """Clear the current user's `game` and redirect to home.

    Accepts POST or GET to avoid CSRF blocking during local development.
    """
    from .models import CustomUser
    user: CustomUser = request.user
    try:
        g = user.primary_game()
        if g:
            g.remove_player(user)
    except Exception:
        pass
    return redirect('home')


@login_required
@require_POST
def join_or_create_game(request):
    """Join a random available game or create a new one and join it.

    - Finds an existing `Game` with at least one empty slot and adds the user.
    - If none exist, creates a new `Game` and adds the user.
    - Sets `user.game` and redirects to the game's page.
    """
    from .models import Game
    from .models import CustomUser

    user: CustomUser = request.user

    # Find an open game (has at least one missing player) and doesn't already include this user
    open_game: Game = (
        Game.objects
        .filter(Q(white__isnull=True) | Q(black__isnull=True))
        .exclude(white=user)
        .exclude(black=user)
        .first()
    )

    # Prefer an atomic DB-side claim of a NULL slot using `update()` so two
    # concurrent joiners don't overwrite each other. This works reliably on
    # SQLite where full row-level locks via `select_for_update()` are limited.
    if open_game is None:
        # Create a new game and claim the `white` slot deterministically.
        import random
        with transaction.atomic():
            open_game = Game.objects.create()
            # Try a safe ORM save on the created row and randomly assign white or black
            g = Game.objects.select_for_update().get(pk=open_game.pk)
            slot = random.choice(['white', 'black'])
            other = 'black' if slot == 'white' else 'white'
            assigned = None
            if getattr(g, slot) is None:
                setattr(g, slot, user)
                g.save(update_fields=[slot])
                assigned = slot
            elif getattr(g, other) is None:
                setattr(g, other, user)
                g.save(update_fields=[other])
                assigned = other
            if assigned:
                print(f"join_or_create_game: created and assigned {assigned} on game {g.pk} -> {assigned}={getattr(getattr(g,assigned),'id',None)}")
                open_game = g
                open_game.ensure_consistent_players()
                if open_game.white and open_game.black:
                    open_game.in_game = True
                    open_game.save(update_fields=['in_game'])
                messages.info(request, f"You were assigned {assigned} on game {open_game.id}.")
                return redirect('game_view', game_id=open_game.id)
        # fallback unlikely: continue to claim via normal path below

    # Try to atomically claim an available slot on the found open_game.
    # Attempt `white` then `black` deterministically.
    for slot in ('white', 'black'):
        try:
            with transaction.atomic():
                g = Game.objects.select_for_update().get(pk=open_game.pk)
                if getattr(g, slot) is None and g.white != user and g.black != user:
                    setattr(g, slot, user)
                    g.save(update_fields=[slot])
                    print(f"join_or_create_game: claimed game {g.pk} slot={slot} -> {slot}={getattr(g,slot).id}")
                    g.ensure_consistent_players()
                    if g.white and g.black:
                        g.in_game = True
                        g.save(update_fields=['in_game'])
                    return redirect('game_view', game_id=g.id)
        except Game.DoesNotExist:
            # Race: game disappeared, try next iteration / fallback
            continue

    # If we couldn't claim any slot (likely filled by another concurrent join),
    # create a fresh game and try to claim that instead.
    # As a last-ditch fallback create a fresh game and assign the user as white.
    import random
    with transaction.atomic():
        open_game = Game.objects.create()
        g = Game.objects.select_for_update().get(pk=open_game.pk)
        slot = random.choice(['white', 'black'])
        other = 'black' if slot == 'white' else 'white'
        assigned = None
        if getattr(g, slot) is None:
            setattr(g, slot, user)
            g.save(update_fields=[slot])
            assigned = slot
        elif getattr(g, other) is None:
            setattr(g, other, user)
            g.save(update_fields=[other])
            assigned = other
        if assigned:
            print(f"join_or_create_game: fallback created and assigned {assigned} on game {g.pk} -> {assigned}={getattr(getattr(g,assigned),'id',None)}")
            g.ensure_consistent_players()
            if g.white and g.black:
                g.in_game = True
                g.save(update_fields=['in_game'])
            messages.info(request, f"You were assigned {assigned} on game {g.id}.")
            return redirect('game_view', game_id=g.id)
    # as a last-ditch fallback, redirect home
    return redirect('home')

@login_required
def home(request):
    # Keep track of the currently logged-in user in session and pass to template
    from .models import CustomUser
    from .models import Game
    current_user: CustomUser = request.user
    request.session['current_user_id'] = current_user.id
    # Ensure CSRF cookie is set so forms and client-side fetches work
    try:
        from django.middleware.csrf import get_token
        get_token(request)
    except Exception:
        pass

    # Collect games the user is currently in so the home page can list them
    try:
        # Only include active games that are not finished
        user_games = list(Game.objects.filter((Q(white=current_user) | Q(black=current_user)), over=False).order_by('id'))
    except Exception:
        user_games = []

    msgs = []
    if (request.method == "POST" or True):
        usernames = User.objects.values_list('username', flat=True)
        for u in usernames:
            msgs.append(u)

    # Show public (non-hidden) and non-full games on the home page
    from django.db.models import Q
    public_games = list(
        Game.objects.filter(hidden=False)
        .filter(Q(white__isnull=True) | Q(black__isnull=True))
        .order_by('id')[:50]
    )

    # Secret games waiting for a specific user
    secret_games = list(
        Game.objects.filter(hidden=False, waiting_for_specific_user=True, spec_opponent_username=current_user.username)
        .filter(Q(white__isnull=True) | Q(black__isnull=True))
        .order_by('id')[:50]
    )

    # Compute win percentage (draw counts as half a win)
    try:
        wins = int(getattr(current_user, 'wins', 0) or 0)
        losses = int(getattr(current_user, 'losses', 0) or 0)
        draws = int(getattr(current_user, 'draws', 0) or 0)
        total = wins + losses + draws
        if total > 0:
            win_pct = round(((wins + 0.5 * draws) / total) * 100.0, 1)
            win_pct_str = f"{win_pct:.1f}"
        else:
            win_pct = 0.0
            win_pct_str = "0.0"
    except Exception:
        win_pct = 0.0
        win_pct_str = "0.0"

    return render(request, 'home.html', {"messages": msgs, "current_user": current_user, "public_games": public_games, "secret_games": secret_games, "user_games": user_games, "win_pct": win_pct_str})


@login_required
def user_games_state(request):
    """Return JSON with the current user's unfinished games for client-side polling."""
    from .models import Game
    user = request.user
    try:
        games_qs = Game.objects.filter((Q(white=user) | Q(black=user)), over=False).order_by('id')
        games = []
        for g in games_qs:
            games.append({
                'id': g.id,
                'white_id': getattr(g.white, 'id', None),
                'white_username': getattr(g.white, 'username', None),
                'black_id': getattr(g.black, 'id', None),
                'black_username': getattr(g.black, 'username', None),
                'over': g.over,
                'white_turn': g.white_turn,
                'is_full': (g.white is not None and g.black is not None)
            })
        # include debug information to help client-side debugging
        debug = {
            'user_id': getattr(user, 'id', None),
            'username': getattr(user, 'username', None),
            'found_count': len(games),
            'db_query_ids': list(games_qs.values_list('id', flat=True)),
            'authenticated': getattr(user, 'is_authenticated', False),
            'session_key': request.session.session_key,
            'cookies': dict(request.COOKIES)
        }
        return JsonResponse({'games': games, 'debug': debug})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def create_specific_game(request):
    """Create a game and mark it as waiting for a specific opponent username.

    POST params: `opponent_username` (string)
    The creator is placed into an available slot (white preferred).
    """
    from .models import Game
    user = request.user
    opponent_username = request.POST.get('opponent_username', '').strip()
    if not opponent_username:
        return redirect('home')

    # If user already has a primary game, redirect to it
    try:
        pg = user.primary_game()
        if pg:
            return redirect('game_view', game_id=pg.id)
    except Exception:
        pass

    # Create game and randomly assign the creator to white or black
    import random
    slot = random.choice(['white', 'black'])
    if slot == 'white':
        g = Game.objects.create(white=user, waiting_for_specific_user=True, spec_opponent_username=opponent_username)
    else:
        g = Game.objects.create(black=user, waiting_for_specific_user=True, spec_opponent_username=opponent_username)
    print(f"create_specific_game: created game {g.id} waiting for {opponent_username} with assigned={slot} white={getattr(g.white,'id',None)} black={getattr(g.black,'id',None)}")
    # Ensure consistency and persist
    try:
        g.ensure_consistent_players()
    except Exception:
        pass
    messages.info(request, f"You were assigned {slot} on game {g.id}.")
    return redirect('game_view', game_id=g.id)


@login_required
def debug_open_games(request):
    """Debug endpoint: show open games and current user's game link."""
    from .models import Game
    from .models import CustomUser
    current = request.user
    # First, ensure consistency on open games so any stale/missing user.game
    # relationships are repaired before we inspect state. This helps recover
    # from prior inconsistent DB states where Game.white/black pointed to a
    # user but that user's `game` FK remained NULL.
    open_games_qs = Game.objects.filter(Q(white__isnull=True) | Q(black__isnull=True))
    open_games = list(open_games_qs)
    for g in open_games:
        try:
            g.ensure_consistent_players()
        except Exception:
            # Defensive: don't let debug view fail if a single game has issues
            pass
    # Re-fetch after attempting to repair
    open_games = list(open_games_qs)
    lines = [f'Current user: id={current.id} username={current.username} game={getattr(current, "game", None)}']
    lines.append('Open games:')
    for g in open_games:
        lines.append(f'  Game {g.id}: white={getattr(g.white, "id", None)} black={getattr(g.black, "id", None)} in_game={g.in_game}')
    return HttpResponse('\n'.join(lines), content_type='text/plain')


@login_required
def repair_games(request):
    """Repair all games by calling `ensure_consistent_players()` on each game
    and cleaning up any users whose `game` FK doesn't match a slot.
    This is a one-shot maintenance endpoint for local debugging.
    """
    from .models import Game
    from django.contrib.auth import get_user_model
    User = get_user_model()

    games = list(Game.objects.all())
    fixed_games = 0
    for g in games:
        before = (getattr(g.white, 'id', None), getattr(g.black, 'id', None))
        try:
            g.ensure_consistent_players()
        except Exception:
            pass
        after = (getattr(g.white, 'id', None), getattr(g.black, 'id', None))
        if before != after:
            fixed_games += 1

    cleaned = []
    from django.db.models import Q
    # No per-user `white_or_black` column to clean; game slot consistency handled above

    return HttpResponse(f'Processed {len(games)} games, fixed {fixed_games} games, cleaned {len(cleaned)} users: {cleaned}', content_type='text/plain')


@login_required
@require_POST
def logout_view(request):
    """Log out the current user and redirect to the index page."""
    logout(request)
    return redirect('index')


@login_required
@require_POST
def submit_move(request):
    """Accept a user's move (JSON `{move: 'A2A3'}`) and apply it to the game.

    Expects CSRF token. Validates user is in a game and it's their turn.
    """
    import json
    import traceback
    from .models import Game

    try:
        # parse JSON body if present, otherwise fall back to form data
        try:
            payload = json.loads(request.body.decode('utf-8')) if request.body else {}
        except Exception:
            payload = {}
        move = payload.get('move') or request.POST.get('move')

        if not move:
            return JsonResponse({'error': 'No move provided'}, status=400)

        user = request.user
        try:
            is_auth = getattr(user, 'is_authenticated', False)
        except Exception:
            is_auth = False

        print(f"submit_move called: user_id={getattr(user,'id',None)} is_authenticated={is_auth} move={move}")
        print('Cookies present:', dict(request.COOKIES))
        print('Session key:', request.session.session_key)

        # Optional: show whether this user is referenced in any games
        try:
            if is_auth:
                from django.contrib.auth import get_user_model
                User = get_user_model()
                from django.db.models import Q
                fresh_games = list(Game.objects.filter(Q(white_id=user.id) | Q(black_id=user.id)).values('id')[:10])
                print('Fresh user from DB: id=', user.id, 'games_sample=', fresh_games)
        except Exception as e:
            print('Error fetching fresh user:', e)

        game = user.primary_game()
        if not game:
            from django.db.models import Q
            open_games = list(Game.objects.filter(Q(white__isnull=True) | Q(black__isnull=True)).values('id', 'white_id', 'black_id', 'in_game')[:10])
            debug = {
                'user_id': getattr(user, 'id', None),
                'user_username': getattr(user, 'username', None),
                'session_key': request.session.session_key,
                'open_games_sample': open_games,
            }
            return JsonResponse({'error': 'User not in a game', 'debug': debug}, status=400)

        # Only allow move when it's this user's turn
        if not game.is_player_turn(user):
            from django.db.models import Q
            debug = {
                'user_id': getattr(user, 'id', None),
                'user_username': getattr(user, 'username', None),
                'user_active_flag': game.is_player_turn(user),
                'game_id': game.id,
                'game_white_id': getattr(game.white, 'id', None),
                'game_black_id': getattr(game.black, 'id', None),
                'game_white_turn': game.white_turn,
                'game_in_game': game.in_game,
            }
            try:
                debug['user_white_or_black'] = game.user_white_or_black(user)
            except Exception:
                debug['user_white_or_black'] = None
            try:
                print('submit_move: turn mismatch debug=', debug)
            except Exception:
                pass
            return JsonResponse({'error': "Not user's turn", 'debug': debug}, status=403)

        # Record the move on the Game and let game logic process it
        try:
            game.latest_move = move
            game.save(update_fields=['latest_move'])
            print(f"saved game.latest_move for game {game.id}: {game.latest_move}")
            game.update_last_seen_move()
            print(f"after update_last_seen_move: game.move_list={game.move_list} last_seen_move={game.last_seen_move}")
        except Exception as e:
            tb = traceback.format_exc()
            print(tb)
            return JsonResponse({'error': str(e), 'trace': tb}, status=500)

        # Return the authoritative game state so clients can immediately sync
        data = {
            'ok': True,
            'move': move,
            'game': {
                'id': game.id,
                'white_id': getattr(game.white, 'id', None),
                'black_id': getattr(game.black, 'id', None),
                'white_turn': game.white_turn,
                'move_list': list(game.move_list or [])
            }
        }
        return JsonResponse(data)

    except Exception as e:
        tb = traceback.format_exc()
        print(tb)
        return JsonResponse({'error': str(e), 'trace': tb}, status=500)


@login_required
def game_state(request, game_id):
    """Return JSON state for the given game to support client polling.

    Fields: id, white_id, black_id, white_turn, move_list
    If the game does not exist, return a JSON 404 (so clients receive
    a machine-readable response instead of Django's HTML 404 page).
    """
    from .models import Game
    try:
        game = Game.objects.get(id=game_id)
    except Game.DoesNotExist:
        return JsonResponse({'error': 'No such game'}, status=404)
    try:
        print(f"game_state requested for game {game_id}: move_list_len={len(game.move_list)} last_seen_move={game.last_seen_move} white_id={getattr(game.white,'id',None)} black_id={getattr(game.black,'id',None)} white_turn={game.white_turn}")
    except Exception:
        try:
            print(f"game_state requested for game {game_id}: move_list_len={len(game.move_list)} last_seen_move={game.last_seen_move}")
        except Exception:
            pass
    data = {
        'id': game.id,
        'white_id': getattr(game.white, 'id', None),
        'black_id': getattr(game.black, 'id', None),
        'white_turn': game.white_turn,
        'move_list': list(game.move_list or []),
        'over': bool(game.over),
        'result_type': getattr(game, 'result_type', None),
        'result_winner_id': getattr(game, 'result_winner_id', None),
        'result_winner_username': None,
        'result_draw_reason': getattr(game, 'result_draw_reason', None)
    }
    # If a winner id exists, expose the username for convenient client display
    try:
        wid = getattr(game, 'result_winner_id', None)
        if wid is not None:
            if game.white and getattr(game.white, 'id', None) == wid:
                data['result_winner_username'] = getattr(game.white, 'username', None)
            elif game.black and getattr(game.black, 'id', None) == wid:
                data['result_winner_username'] = getattr(game.black, 'username', None)
            else:
                # fallback: try to fetch from DB
                try:
                    User = get_user_model()
                    u = User.objects.filter(id=wid).first()
                    data['result_winner_username'] = getattr(u, 'username', None) if u else None
                except Exception:
                    data['result_winner_username'] = None
    except Exception:
        pass
    return JsonResponse(data)

def makemove(gameid, userid, move):
    from .models import Game
    game = get_object_or_404(Game, id=gameid)
    game.make_move(userid, move)
    return JsonResponse({'status': 'move made'})

def ask_move_made(gameid, userid):
    from .models import Game
    game = get_object_or_404(Game, id=gameid)
    user = get_object_or_404(User, id=userid)
    if game.last_seen_move != game.latest_move and (game.white == user or game.black == user):
        return JsonResponse({'move_made': True, 'latest_move': game.latest_move})
    else:
        return JsonResponse({'move_made': False})


# Simple AJAX echo page and API
def ajax_echo_page(request):
    try:
        from django.middleware.csrf import get_token
        get_token(request)
    except Exception:
        pass
    return render(request, 'ajax_echo.html')


@require_POST
def ajax_echo(request):
    """API endpoint: accepts POST (JSON or form) with `text` and returns JSON echo."""
    import json
    try:
        payload = json.loads(request.body.decode('utf-8'))
        text = payload.get('text')
    except Exception:
        text = request.POST.get('text')

    if text is None:
        return JsonResponse({'error': 'No text provided'}, status=400)

    return JsonResponse({'echo': text})


@login_required
@require_POST
def declare_win(request):
    """Endpoint to declare a winner for a game. Expects JSON {game_id: int, winner_id: int}."""
    import json
    from .models import Game
    try:
        payload = json.loads(request.body.decode('utf-8'))
        game_id = int(payload.get('game_id'))
        winner_id = int(payload.get('winner_id'))
    except Exception:
        return JsonResponse({'error': 'Invalid payload'}, status=400)
    game = get_object_or_404(Game, id=game_id)
    # Only allow participants to declare results for their game
    if request.user != game.white and request.user != game.black:
        return JsonResponse({'error': 'Not a participant'}, status=403)
    try:
        winner = None
        if game.white and game.white.id == winner_id:
            winner = game.white
        elif game.black and game.black.id == winner_id:
            winner = game.black
        else:
            return JsonResponse({'error': 'Winner not a participant'}, status=400)
        game.winner(winner)
        # Return winner info so clients can render authoritative message
        opponent = game.opponent(winner)
        return JsonResponse({
            'ok': True,
            'winner_id': getattr(winner, 'id', None),
            'winner_username': getattr(winner, 'username', None),
            'winner_wins': getattr(winner, 'wins', None),
            'opponent_id': getattr(opponent, 'id', None),
            'opponent_losses': getattr(opponent, 'losses', None)
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def declare_draw(request):
    """Endpoint to declare a draw for a game. Expects JSON {game_id: int}."""
    import json
    from .models import Game
    try:
        payload = json.loads(request.body.decode('utf-8')) if request.body else {}
        game_id = int(payload.get('game_id'))
        reason = payload.get('reason')
    except Exception:
        return JsonResponse({'error': 'Invalid payload'}, status=400)
    game = get_object_or_404(Game, id=game_id)
    if request.user != game.white and request.user != game.black:
        return JsonResponse({'error': 'Not a participant'}, status=403)
    try:
        # Normalize reason strings
        if reason not in (None, '50-move', 'threefold', 'no-legal-moves', 'stalemate'):
            reason = None
        game.draw(reason=reason)
        return JsonResponse({'ok': True, 'result_draw_reason': getattr(game, 'result_draw_reason', None)})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
    
@login_required
@require_POST
def resign_game(request):
    """Endpoint for a player to resign from their current game."""
    from .models import Game
    user = request.user
    game = user.primary_game()
    if not game:
        return JsonResponse({'error': 'User not in a game'}, status=400)
    if request.user != game.white and request.user != game.black:
        return JsonResponse({'error': 'Not a participant'}, status=403)
    try:
        opponent = game.opponent(user)
        game.winner(opponent)
        return JsonResponse({
            'ok': True,
            'winner_id': getattr(opponent, 'id', None),
            'winner_username': getattr(opponent, 'username', None),
            'winner_wins': getattr(opponent, 'wins', None)
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
    
@login_required
@require_POST
def new_game(request, game_id):
    """Starts a new game with both of the players from the finished game with id `game_id`."""
    from .models import Game
    old_game = get_object_or_404(Game, id=game_id)
    if request.user != old_game.white and request.user != old_game.black:
        return JsonResponse({'error': 'Not a participant of the specified game'}, status=403)
    try:
        new_game = Game.objects.create(white=old_game.white, black=old_game.black)
        new_game.ensure_consistent_players()
        # Clear any rematch tracking on the old game and record the created id
        try:
            old_game.rematch_new_game_id = new_game.id
            old_game.rematch_white_requested = False
            old_game.rematch_black_requested = False
            old_game.save(update_fields=['rematch_new_game_id', 'rematch_white_requested', 'rematch_black_requested'])
        except Exception:
            pass
        return JsonResponse({'ok': True, 'new_game_id': new_game.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def rematch_request(request, game_id):
    """Handle a rematch request from one participant. If both participants request,
    create a new game with the same players and return its id."""
    from .models import Game
    old_game = get_object_or_404(Game, id=game_id)
    if request.user != old_game.white and request.user != old_game.black:
        return JsonResponse({'error': 'Not a participant of the specified game'}, status=403)
    try:
        is_white = (request.user == old_game.white)
        if is_white:
            old_game.rematch_white_requested = True
        else:
            old_game.rematch_black_requested = True
        old_game.save(update_fields=['rematch_white_requested', 'rematch_black_requested'])

        both = bool(old_game.rematch_white_requested and old_game.rematch_black_requested)
        if both and not old_game.rematch_new_game_id:
            new_game = Game.objects.create(white=old_game.white, black=old_game.black)
            new_game.ensure_consistent_players()
            old_game.rematch_new_game_id = new_game.id
            old_game.rematch_white_requested = False
            old_game.rematch_black_requested = False
            old_game.save(update_fields=['rematch_new_game_id', 'rematch_white_requested', 'rematch_black_requested'])
            return JsonResponse({'ok': True, 'both_requested': True, 'new_game_id': new_game.id})

        return JsonResponse({'ok': True, 'both_requested': both, 'rematch_white_requested': old_game.rematch_white_requested, 'rematch_black_requested': old_game.rematch_black_requested})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)