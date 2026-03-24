#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SITE_DIR = Path('/Users/arubachen/.openclaw/workspace/news-site')
WHITELIST = [
    'data/news.json',
]
HOLD_FILE = SITE_DIR / '.publish-hold'
LOCK_FILE = SITE_DIR / 'data/news.json.lock'


def emit(ok: bool, changed: bool, message: str) -> None:
    print(json.dumps({'ok': ok, 'changed': changed, 'message': message}, ensure_ascii=False))


def run(*args: str, check: bool = True, capture: bool = False, quiet: bool = False) -> subprocess.CompletedProcess[str]:
    kwargs: dict[str, object] = {'check': check, 'text': True}
    if capture:
        kwargs['stdout'] = subprocess.PIPE
        kwargs['stderr'] = subprocess.PIPE
    elif quiet:
        kwargs['stdout'] = subprocess.DEVNULL
    return subprocess.run(list(args), **kwargs)


os.chdir(SITE_DIR)

inside = subprocess.run(
    ['git', 'rev-parse', '--is-inside-work-tree'],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
if inside.returncode != 0:
    emit(False, False, 'not-a-git-repo')
    sys.exit(1)

if HOLD_FILE.exists():
    emit(True, False, 'publish-hold')
    sys.exit(0)

LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
with open(LOCK_FILE, 'a+', encoding='utf-8') as lock_fp:
    try:
        fcntl.flock(lock_fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        emit(True, False, 'data-lock-busy')
        sys.exit(0)

    run('npm', 'run', 'validate', quiet=True)

    status = run('git', 'status', '--porcelain', '--', *WHITELIST, capture=True)
    if not status.stdout.strip():
        emit(True, False, 'no-whitelisted-changes')
        sys.exit(0)

    run('git', 'add', '--', *WHITELIST)

    staged = subprocess.run(['git', 'diff', '--cached', '--quiet', '--', *WHITELIST])
    if staged.returncode == 0:
        emit(True, False, 'nothing-staged')
        sys.exit(0)

    stamp = datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %z')
    run('git', 'commit', '-m', f'chore: sync news-site content ({stamp})', '--', *WHITELIST, quiet=True)
    run('git', 'push', 'origin', 'main', quiet=True)

    emit(True, True, 'published')
PY
