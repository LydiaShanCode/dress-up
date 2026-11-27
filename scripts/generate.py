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
    ap.add_argument('--resolution', default='1K', choices=['0.5K', '1K', '2K', '4K'])
    ap.add_argument('--aspect', default='auto', help="'auto' keeps image 1's shape (needed for layers to line up)")
    ap.add_argument('--gemini-model', default=GEMINI_MODEL)
    ap.add_argument('--n', type=int, default=1, help='variations (each is billed)')
    ap.add_argument('--yes', action='store_true', help='skip the cost confirmation')
    ap.add_argument('--cap', type=float, default=float(os.environ.get('MONTHLY_CAP', 5)),
                    help='refuse to run past this many dollars this month (default $5, or MONTHLY_CAP)')
    a = ap.parse_args()

    folder = Path(a.folder).resolve()
    text = (folder / 'PROMPT.txt').read_text()
    prompt = text.split('-' * 20, 1)[-1].lstrip('-\n ').strip()
    images = sorted(p for p in folder.iterdir() if p.name[0].isdigit() and p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
    if not images:
        sys.exit('No numbered reference images in ' + str(folder))

    cost = PRICE[a.provider][a.resolution] * a.n
    import json, datetime
    log_path = ROOT / 'captures' / 'spend.json'
    log = json.loads(log_path.read_text()) if log_path.exists() else []
    month = datetime.date.today().strftime('%Y-%m')
    spent = sum(e['usd'] for e in log if e['date'].startswith(month))
    print(f'Spent this month: ${spent:.2f} of ${a.cap:.2f} cap')
    if spent + cost > a.cap:
        sys.exit(f'Over the monthly cap: this run (${cost:.2f}) would take you past ${a.cap:.2f}. Raise it with --cap.')
    print(f'{a.provider} · {a.gemini_model if a.provider == "gemini" else MODEL} · {a.n} image(s) at {a.resolution} · about ${cost:.2f}')
    for p in images:
        print('  ref', p.name)
    if not a.yes and input('Generate? [y/N] ').strip().lower() != 'y':
        sys.exit('Cancelled, nothing spent.')

    load_key(KEYNAME[a.provider])

    def record():
        # re-read right before writing (with a lock) so parallel runs can't drop each other's entry
        import fcntl
        log_path.parent.mkdir(exist_ok=True)
        with open(log_path, 'a+') as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            fh.seek(0); text = fh.read()
            entries = json.loads(text) if text.strip() else []
            entries.append({'date': datetime.date.today().isoformat(), 'job': folder.name, 'provider': a.provider,
                            'resolution': a.resolution, 'images': a.n, 'usd': round(cost, 3)})
            fh.seek(0); fh.truncate(); fh.write(json.dumps(entries, indent=1))

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
        record()
    else:
        import base64, io, json, mimetypes, urllib.error
        from PIL import Image
        # Lock the framing: pad image 1 (you) with its own backdrop color to the nearest
        # supported shape, ask for exactly that shape, then crop the result back to your
        # photo's area. Otherwise Gemini may pick its own framing and layers won't line up.
        SHAPES = {'9:16': 9 / 16, '2:3': 2 / 3, '3:4': 3 / 4, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9}
        first = Image.open(images[0]).convert('RGB')
        W, H = first.size
        aspect = a.aspect if a.aspect != 'auto' else min(SHAPES, key=lambda k: abs(SHAPES[k] - W / H))
        r = SHAPES.get(aspect, W / H)
        PW, PH = (round(H * r), H) if W / H < r else (W, round(W / r))
        ox, oy = (PW - W) // 2, (PH - H) // 2
        padded = Image.new('RGB', (PW, PH), first.getpixel((2, 2)))
        padded.paste(first, (ox, oy))
        buf = io.BytesIO(); padded.save(buf, 'PNG')
        datas = [('image/png', buf.getvalue())] + [(mimetypes.guess_type(p.name)[0] or 'image/png', p.read_bytes()) for p in images[1:]]

        def uncrop(raw):
            im = Image.open(io.BytesIO(raw)).convert('RGB').resize((PW, PH), Image.LANCZOS)
            out = io.BytesIO(); im.crop((ox, oy, ox + W, oy + H)).save(out, 'PNG'); return out.getvalue()

        # REST generateContent (key in a header, never in the URL)
        body = {
            'contents': [{'parts': [{'text': prompt}] + [
                {'inline_data': {'mime_type': mt, 'data': base64.b64encode(d).decode()}} for mt, d in datas]}],
            'generationConfig': {'responseModalities': ['IMAGE'],
                                 'imageConfig': {'aspectRatio': aspect, 'imageSize': a.resolution}},
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
            out = out_path(); out.write_bytes(uncrop(base64.b64decode(imgs[-1]['data']))); print('saved', out.relative_to(ROOT))
        record()

if __name__ == '__main__':
    main()
