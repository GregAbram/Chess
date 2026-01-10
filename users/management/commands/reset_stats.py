from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum


class Command(BaseCommand):
    help = 'Reset wins, losses, and draws for all users. Use --yes to apply.'

    def add_arguments(self, parser):
        parser.add_argument('--yes', action='store_true', help='Apply changes without prompt')

    def handle(self, *args, **options):
        User = get_user_model()
        total = User.objects.count()
        sums = User.objects.aggregate(total_wins=Sum('wins'), total_losses=Sum('losses'), total_draws=Sum('draws'))
        total_wins = sums.get('total_wins') or 0
        total_losses = sums.get('total_losses') or 0
        total_draws = sums.get('total_draws') or 0

        self.stdout.write(f'Users: {total}')
        self.stdout.write(f'Total wins: {total_wins}, losses: {total_losses}, draws: {total_draws}')

        if not options.get('yes'):
            confirm = input('Proceed to reset all stats to zero? Type YES to continue: ')
            if confirm != 'YES':
                self.stdout.write('Aborted by user. No changes made.')
                return

        with transaction.atomic():
            updated = User.objects.update(wins=0, losses=0, draws=0)
        self.stdout.write(self.style.SUCCESS(f'Reset stats for {updated} users.'))
