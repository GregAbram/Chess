from django.core.management.base import BaseCommand
from django.db import transaction
from django.conf import settings
from pathlib import Path
import shutil
from datetime import datetime


class Command(BaseCommand):
    help = 'Backup DB and remove all games, unlink users from games'

    def handle(self, *args, **options):
        # Determine DB file path (SQLite)
        db_name = settings.DATABASES.get('default', {}).get('NAME')
        if not db_name:
            self.stderr.write('Could not determine database file path from settings.DATABASES')
            return
        db_path = Path(db_name)
        if not db_path.exists():
            # Try resolve relative to BASE_DIR
            db_path = Path(settings.BASE_DIR) / db_name
        db_path = db_path.resolve()

        # Clear via ORM
        from users.models import Game, CustomUser

        with transaction.atomic():
            games_count = Game.objects.count()
            from django.db.models import Q
            users_count = CustomUser.objects.filter(Q(games_as_white__isnull=False) | Q(games_as_black__isnull=False)).distinct().count()

            # Delete all games entirely
            Game.objects.all().delete()

        # If using SQLite, reset the autoincrement sequence for users_game
        try:
            from django.db import connection
            with connection.cursor() as cur:
                cur.execute("DELETE FROM sqlite_sequence WHERE name='users_game'")
        except Exception:
            pass

        self.stdout.write(self.style.SUCCESS(f'Deleted {games_count} games and unlinked {users_count} users'))
