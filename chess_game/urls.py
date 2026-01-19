from django.urls import path
from django.contrib import admin
from . import views
from django.urls import path,include
from chess_game.views import *
from django.conf import settings
from django.contrib.staticfiles.urls import staticfiles_urlpatterns
from django.conf.urls.static import static

urlpatterns = [
    path('', index, name="index"),
    path('admin/', admin.site.urls),
    path('home/', home, name="home"),
    path('login/',login_page,name="login_page"),
    path('game/<int:game_id>/', game, name='game_view'),
    path('play/', join_or_create_game, name='join_game'),
    path('create_specific/', create_specific_game, name='create_specific_game'),
    path('debug_open_games/', debug_open_games, name='debug_open_games'),
    path('repair_games/', repair_games, name='repair_games'),
    path('state/<int:game_id>/', game_state, name='game_state'),
    path('rematch/<int:game_id>/', views.rematch_request, name='rematch_request'),
    path('move/', submit_move, name='submit_move'),
    path('declare_win/', views.declare_win, name='declare_win'),
    path('declare_draw/', views.declare_draw, name='declare_draw'),
    path('user_games_state/', views.user_games_state, name='user_games_state'),
    path('ajax/', views.ajax_echo_page, name='ajax_echo_page'),
    path('ajax/echo/', views.ajax_echo, name='ajax_echo_api'),
    path('leave/', leave_game, name='leave_game'),
    path('logout/', logout_view, name='logout'),
    path('register/',register_page,name="register_page")
]
