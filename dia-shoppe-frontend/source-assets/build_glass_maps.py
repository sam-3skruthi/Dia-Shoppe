"""Builds the transmittance maps used by the D + S glass renderer.

Originals (glass-D/S.original.webp) are never modified. For each letter this
writes, into src/assets/dia/:
  <l>-mul.webp  how much each pixel darkens what is behind it  (0..1)
  <l>-add.webp  additive highlight / prismatic light, stored x4 (0..0.25 -> 0..1)
at full size and a 1024px-wide mobile size (suffix -m).
Reconstruction: T = mul + add/4*... see shader; over any LIGHT surface
  out = surface * mul + add.  (Dark surfaces use the emissive mode in the shader.)
Run:  python3 -I source-assets/build_glass_maps.py
"""
import numpy as np, pathlib
from PIL import Image
HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / 'src' / 'assets' / 'dia'
ADD_SCALE = 4.0

def fit_backdrop(a):
    h, w, _ = a.shape
    yy, xx = np.mgrid[0:h, 0:w]; x = (xx / w - .5) * 2; y = (yy / h - .5) * 2
    m = np.zeros((h, w), bool); b = 36
    m[:b, :] = 1; m[:, :b] = 1; m[:, -b:] = 1
    F = np.stack([np.ones_like(x), x, y, x*x, x*y, y*y, x**3, x*x*y, x*y*y, y**3], -1)
    bg = np.zeros_like(a)
    for c in range(3):
        v = a[..., c]; sel = m.copy()
        for _ in range(3):
            coef, *_ = np.linalg.lstsq(F[sel], v[sel], rcond=None)
            fit = F @ coef; res = np.abs(v - fit)
            sel = m & (res < np.percentile(res[m], 85))
        bg[..., c] = fit
    return bg

for letter in ('D', 'S'):
    a = np.asarray(Image.open(HERE / f'glass-{letter}.original.webp').convert('RGB')).astype(float)
    h, w, _ = a.shape
    T = a / np.maximum(fit_backdrop(a), 1)
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.maximum(np.abs(xx / w - .5), np.abs(yy / h - .5)) * 2
    f = np.clip((1 - r) / 0.12, 0, 1)[..., None]       # feather edges to neutral
    mul = np.clip(T, 0, 1) * f + (1 - f)
    add = np.clip(T - 1, 0, 1 / ADD_SCALE) * f * ADD_SCALE
    for suffix, width in (('', w), ('-m', 1024)):
        for name, arr in (('mul', mul), ('add', add)):
            im = Image.fromarray(np.round(arr * 255).astype(np.uint8))
            if width != w: im = im.resize((width, round(h * width / w)), Image.LANCZOS)
            im.save(OUT / f'{letter.lower()}-{name}{suffix}.webp', quality=94, method=6)
print('done')
