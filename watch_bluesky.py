#!/usr/bin/env python3
import os, time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from atproto import Client

WATCH_DIR = Path('/Users/saiko/Desktop/bluesky')
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}

handle = os.getenv('BSKY_HANDLE')
password = os.getenv('BSKY_APP_PASSWORD')
if not handle or not password:
    raise RuntimeError('Set BSKY_HANDLE and BSKY_APP_PASSWORD first')
if not WATCH_DIR.exists():
    raise RuntimeError(f'Missing folder: {WATCH_DIR}')

client = Client()
client.login(handle, password)

posted = set()

def stable(path: Path, rounds=6, delay=0.4):
    last = -1
    same = 0
    for _ in range(rounds * 3):
        if not path.exists():
            return False
        size = path.stat().st_size
        if size > 0 and size == last:
            same += 1
            if same >= rounds:
                return True
        else:
            same = 0
        last = size
        time.sleep(delay)
    return False

def post_image(path: Path):
    if path in posted:
        return
    if path.suffix.lower() not in IMAGE_EXTS:
        return
    if not stable(path):
        print(f'Skipped (not stable): {path.name}')
        return
    try:
        data = path.read_bytes()
        uploaded = client.upload_blob(data)
        text = f'Auto-upload: {path.name}'
        client.send_post(text=text, embed={
            '$type': 'app.bsky.embed.images',
            'images': [{'alt': path.stem[:1000], 'image': uploaded.blob}],
        })
        posted.add(path)
        print(f'Posted: {path.name}')
    except Exception as e:
        print(f'Failed {path.name}: {e}')

class Handler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            post_image(Path(event.src_path))
    def on_moved(self, event):
        if not event.is_directory:
            post_image(Path(event.dest_path))

if __name__ == '__main__':
    print(f'Watching {WATCH_DIR} ...')
    obs = Observer()
    obs.schedule(Handler(), str(WATCH_DIR), recursive=False)
    obs.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        obs.stop()
        obs.join()
