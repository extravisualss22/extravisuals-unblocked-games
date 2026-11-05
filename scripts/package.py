"""Create an installable unpacked Chrome extension archive, including local engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
extension = root / 'chess-assistant'
required = ['vendor/stockfish-19-single.js', 'vendor/stockfish-19-single.wasm', 'vendor/chess.js']
for filename in required:
    if not (extension / filename).is_file():
        raise SystemExit('Missing engine files. Run npm ci and npm run vendor first.')
destination = root / 'dist'
destination.mkdir(exist_ok=True)
archive = destination / 'travis.suda.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=6) as output:
    for path in sorted(extension.rglob('*')):
        if path.is_file() and 'tests' not in path.relative_to(extension).parts:
            output.write(path, Path('travis.suda') / path.relative_to(extension))
print(f'{archive} ({archive.stat().st_size / 1024 / 1024:.1f} MB)')
