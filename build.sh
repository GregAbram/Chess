#!/usr/bin/env bash
set -o errexit  # stop on errors
echo AAAAAAA build.sh
pip install -r requirements.txt
echo BBBBBBB build.sh
python manage.py collectstatic --noinput
echo CCCCCCC build.sh
python manage.py migrate
echo DDDDDDD build.sh
