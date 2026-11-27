"""
Generate an image with Nano Banana 2 (edit) on fal.ai, from a prompt and reference images.

  .venv/bin/python scripts/generate.py captures/handoff/1-new-base
  .venv/bin/python scripts/generate.py <folder> --resolution 1K --n 2

A job folder holds numbered reference images (1-*.jpg, 2-*.png, ...) and PROMPT.txt
(everything after the dashed line is the prompt). Results are saved in the folder as
RESULT.png, RESULT-2.png, ... The key is read from FAL_KEY in .env and never printed.

Cost (fal list price): $0.08 per image at 1K, $0.12 at 2K, $0.16 at 4K.
"""
import argparse, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'fal-ai/nano-banana-2/edit'
PRICE = {'0.5K': 0.06, '1K': 0.08, '2K': 0.12, '4K': 0.16}


def load_key():
    if os.environ.get('FAL_KEY'):
        return
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('FAL_KEY='):
                os.environ['FAL_KEY'] = line.split('=', 1)[1].strip().strip('"\'')
    if not os.environ.get('FAL_KEY') or 'paste-your' in os.environ['FAL_KEY']:
        sys.exit('No FAL_KEY: put FAL_KEY=... in dress-up/.env (git-ignored).')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--resolution', default='2K', choices=list(PRICE))
    ap.add_argument('--aspect', default='9:16')
    ap.add_argument('--n', type=int, default=1, help='variations (each is billed)')
    ap.add_argument('--yes', action='store_true', help='skip the cost confirmation')
    a = ap.parse_args()

    folder = Path(a.folder)
    text = (folder / 'PROMPT.txt').read_text()
    prompt = text.split('-' * 20, 1)[-1].lstrip('-\n ').strip()
    images = sorted(p for p in folder.iterdir() if p.name[0].isdigit() and p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
    if not images:
        sys.exit('No numbered reference images in ' + str(folder))

    cost = PRICE[a.resolution] * a.n
    print(f'{MODEL} · {a.n} image(s) at {a.resolution} · about ${cost:.2f}')
    for p in images:
        print('  ref', p.name)
    if not a.yes and input('Generate? [y/N] ').strip().lower() != 'y':
        sys.exit('Cancelled, nothing spent.')

    load_key()
    import fal_client
    urls = [fal_client.upload_file(str(p)) for p in images]
    res = fal_client.subscribe(MODEL, arguments={
        'prompt': prompt, 'image_urls': urls, 'num_images': a.n,
        'aspect_ratio': a.aspect, 'resolution': a.resolution, 'output_format': 'png',
    }, with_logs=False)
    for i, img in enumerate(res['images']):
        out = folder / ('RESULT.png' if i == 0 and not (folder / 'RESULT.png').exists() else f'RESULT-{len(list(folder.glob("RESULT*"))) + 1}.png')
        urllib.request.urlretrieve(img['url'], out)
        print('saved', out.relative_to(ROOT))


if __name__ == '__main__':
    main()
