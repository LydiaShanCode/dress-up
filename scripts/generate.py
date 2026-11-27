"""
Generate an image with Nano Banana from a prompt and reference images, via fal.ai or the Gemini API.

  .venv/bin/python scripts/generate.py captures/handoff/1-new-base
  .venv/bin/python scripts/generate.py <folder> --resolution 1K --n 2

A job folder holds numbered reference images (1-*.jpg, 2-*.png, ...) and PROMPT.txt
(everything after the dashed line is the prompt). Results are saved in the folder as
RESULT.png, RESULT-2.png, ... Keys are read from .env (FAL_KEY or GEMINI_API_KEY) and never printed.

  --provider fal     fal-ai/nano-banana-2/edit: $0.08 per image at 1K, $0.12 at 2K
  --provider gemini  gemini-3.1-flash-image (Nano Banana 2): about $0.07 at 1K, $0.10 at 2K
                     (needs a billed key: the Gemini API free tier has no image output)
"""
import argparse, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'fal-ai/nano-banana-2/edit'
GEMINI_MODEL = 'gemini-3.1-flash-image'  # Nano Banana 2; try --gemini-model gemini-nano-banana-2.1
PRICE = {'fal': {'0.5K': 0.06, '1K': 0.08, '2K': 0.12, '4K': 0.16},
         'gemini': {'0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151}}
KEYNAME = {'fal': 'FAL_KEY', 'gemini': 'GEMINI_API_KEY'}


def load_key(name):
    if not os.environ.get(name):
        env = ROOT / '.env'
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith(name + '='):
                    os.environ[name] = line.split('=', 1)[1].strip().strip('"\'')
    if not os.environ.get(name) or 'paste-your' in os.environ[name]:
        sys.exit(f'No {name}: put {name}=... in dress-up/.env (git-ignored).')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--provider', default='gemini', choices=['gemini', 'fal'])
    ap.add_argument('--resolution', default='2K', choices=['0.5K', '1K', '2K', '4K'])
    ap.add_argument('--aspect', default='9:16')
    ap.add_argument('--gemini-model', default=GEMINI_MODEL)
    ap.add_argument('--n', type=int, default=1, help='variations (each is billed)')
    ap.add_argument('--yes', action='store_true', help='skip the cost confirmation')
    a = ap.parse_args()

    folder = Path(a.folder)
    text = (folder / 'PROMPT.txt').read_text()
    prompt = text.split('-' * 20, 1)[-1].lstrip('-\n ').strip()
    images = sorted(p for p in folder.iterdir() if p.name[0].isdigit() and p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
    if not images:
        sys.exit('No numbered reference images in ' + str(folder))

    cost = PRICE[a.provider][a.resolution] * a.n
    print(f'{a.provider} · {a.gemini_model if a.provider == "gemini" else MODEL} · {a.n} image(s) at {a.resolution} · about ${cost:.2f}')
    for p in images:
        print('  ref', p.name)
    if not a.yes and input('Generate? [y/N] ').strip().lower() != 'y':
        sys.exit('Cancelled, nothing spent.')

    load_key(KEYNAME[a.provider])

    def out_path():
        n = len(list(folder.glob('RESULT*')))
        return folder / ('RESULT.png' if n == 0 else f'RESULT-{n + 1}.png')

    if a.provider == 'fal':
        import fal_client
        urls = [fal_client.upload_file(str(p)) for p in images]
        res = fal_client.subscribe(MODEL, arguments={
            'prompt': prompt, 'image_urls': urls, 'num_images': a.n,
            'aspect_ratio': a.aspect, 'resolution': a.resolution, 'output_format': 'png',
        }, with_logs=False)
        for img in res['images']:
            out = out_path(); urllib.request.urlretrieve(img['url'], out); print('saved', out.relative_to(ROOT))
    else:
        import base64, json, mimetypes, urllib.error
        # REST generateContent (key in a header, never in the URL)
        body = {
            'contents': [{'parts': [{'text': prompt}] + [
                {'inline_data': {'mime_type': mimetypes.guess_type(p.name)[0] or 'image/png',
                                 'data': base64.b64encode(p.read_bytes()).decode()}} for p in images]}],
            'generationConfig': {'responseModalities': ['IMAGE'],
                                 'imageConfig': {'aspectRatio': a.aspect, 'imageSize': a.resolution}},
        }
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{a.gemini_model}:generateContent'
        for _ in range(a.n):
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={
                'Content-Type': 'application/json', 'x-goog-api-key': os.environ['GEMINI_API_KEY']})
            try:
                res = json.load(urllib.request.urlopen(req, timeout=300))
            except urllib.error.HTTPError as e:
                sys.exit(f'Gemini API error {e.code}: {e.read().decode()[:400]}')
            parts = [pt for c in res.get('candidates', []) for pt in c.get('content', {}).get('parts', [])]
            imgs = [pt.get('inline_data') or pt.get('inlineData') for pt in parts if pt.get('inline_data') or pt.get('inlineData')]
            if not imgs:
                sys.exit('No image returned: ' + json.dumps(res)[:400])
            out = out_path(); out.write_bytes(base64.b64decode(imgs[-1]['data'])); print('saved', out.relative_to(ROOT))

if __name__ == '__main__':
    main()
