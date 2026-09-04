# Branding image fixtures

Real encoder output, not hand-assembled headers. Hand-built bytes would test
the parser against the same reading of the spec that produced it — they agree
by construction and prove nothing.

Between them these cover all three WebP container flavours a browser can emit.
That distinction is the one that matters: a parser handling only `VP8X` rejects
the lossy files browsers produce for a photo, and a header image is a photo.

| File                                   | Format | Chunk  | Purpose                      |
| -------------------------------------- | ------ | ------ | ---------------------------- |
| `logo-512.png`                         | PNG    | `IHDR` | Happy path for the logo slot |
| `header-desktop-1600x900.webp`         | WebP   | `VP8 ` | Lossy — the common case      |
| `header-tablet-1024x576-lossless.webp` | WebP   | `VP8L` | Lossless                     |
| `header-phone-768x432-vp8x.webp`       | WebP   | `VP8X` | Extended (alpha)             |
| `wrong-size-800x600.webp`              | WebP   | `VP8 ` | Dimension rejection          |

Flat-colour images, so every file is under 3 KB.

## Regenerating

Needs `ffmpeg` and `cwebp` (`brew install ffmpeg webp`):

```bash
T=$(mktemp -d)
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2383e2:s=512x512,format=rgba" -frames:v 1 "$T/logo.png"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2383e2:s=1600x900"            -frames:v 1 "$T/d.png"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2383e2:s=1024x576"            -frames:v 1 "$T/t.png"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2383e2@0.6:s=768x432,format=rgba" -frames:v 1 "$T/pa.png"
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x2383e2:s=800x600"             -frames:v 1 "$T/wrong.png"

cp "$T/logo.png" logo-512.png
cwebp -quiet -q 80       "$T/d.png"     -o header-desktop-1600x900.webp
cwebp -quiet -lossless   "$T/t.png"     -o header-tablet-1024x576-lossless.webp
cwebp -quiet -q 80       "$T/pa.png"    -o header-phone-768x432-vp8x.webp
cwebp -quiet -q 80       "$T/wrong.png" -o wrong-size-800x600.webp
```

`VP8X` only appears when an extended feature is present — hence the alpha on
the phone fixture. A plain `cwebp` of an opaque image emits `VP8 `.
