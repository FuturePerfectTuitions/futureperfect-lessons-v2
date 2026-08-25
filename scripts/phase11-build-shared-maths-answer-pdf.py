#!/usr/bin/env python3

import argparse
import hashlib
import shutil
from pathlib import Path

import fitz


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def unpack_color(value: int):
    packed = int(value or 0)
    return (
        ((packed >> 16) & 255) / 255,
        ((packed >> 8) & 255) / 255,
        (packed & 255) / 255,
    )


def span_for_rect(page, rect):
    best = None
    best_area = -1.0
    for block in page.get_text('dict').get('blocks', []):
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                srect = fitz.Rect(span.get('bbox', (0, 0, 0, 0)))
                overlap = srect & rect
                area = max(0.0, overlap.width) * max(0.0, overlap.height)
                if area > best_area:
                    best = span
                    best_area = area
    return best


def insert_code(page, rect, span, text):
    font = str(span.get('font', '') or '') if span else ''
    size = float(span.get('size', max(8.0, rect.height * 0.8)) if span else max(8.0, rect.height * 0.8))
    color = unpack_color(span.get('color', 0) if span else 0)
    baseline = float(span.get('origin', (rect.x0, rect.y1 - 1))[1]) if span else rect.y1 - 1

    candidates = []
    if font:
        candidates.append(font)
    lower = font.lower()
    candidates.append('hebo' if 'bold' in lower else 'helv')

    last_error = None
    for fontname in dict.fromkeys(candidates):
        try:
            page.insert_text(
                (rect.x0, baseline),
                text,
                fontname=fontname,
                fontsize=size,
                color=color,
                overlay=True,
            )
            return fontname
        except Exception as exc:  # pragma: no cover - exercised only by unusual embedded fonts
            last_error = exc
    raise RuntimeError(f'Could not reinsert code {text}: {last_error}')


def build(source: Path, output: Path, old_code: str, new_code: str):
    if not old_code or not new_code:
        raise RuntimeError('Both old_code and new_code are required.')
    if len(old_code) != len(new_code):
        raise RuntimeError(f'Code lengths differ: {old_code} vs {new_code}.')

    source_hash = sha256_file(source)
    document = fitz.open(source)
    try:
        original_pages = document.page_count
        original_text = '\n'.join(page.get_text('text') for page in document)
        old_count = original_text.count(old_code)
        new_count_before = original_text.count(new_code)

        if old_count == 0:
            document.close()
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, output)
            print(f'source_sha256={source_hash}')
            print(f'output_sha256={sha256_file(output)}')
            print('replacements=0')
            print(f'pages={original_pages}')
            print('mode=unchanged-copy')
            return

        matches = []
        for page_number, page in enumerate(document):
            for rect in page.search_for(old_code):
                matches.append((page_number, fitz.Rect(rect), span_for_rect(page, fitz.Rect(rect))))

        if len(matches) != old_count:
            raise RuntimeError(
                f'Expected {old_count} searchable occurrences of {old_code}, found {len(matches)}. '
                'Refusing a partial PDF rewrite.'
            )

        by_page = {}
        for page_number, rect, span in matches:
            by_page.setdefault(page_number, []).append((rect, span))

        for page_number, items in by_page.items():
            page = document[page_number]
            for rect, _span in items:
                redaction = fitz.Rect(rect)
                redaction.x0 -= 0.8
                redaction.x1 += 0.8
                redaction.y0 -= 0.5
                redaction.y1 += 0.5
                page.add_redact_annot(redaction, fill=(1, 1, 1))
            page.apply_redactions()
            for rect, span in items:
                insert_code(page, rect, span, new_code)

        output.parent.mkdir(parents=True, exist_ok=True)
        document.save(output, garbage=4, deflate=True, clean=True)
    finally:
        if not document.is_closed:
            document.close()

    check = fitz.open(output)
    try:
        rewritten_text = '\n'.join(page.get_text('text') for page in check)
        if check.page_count != original_pages:
            raise RuntimeError('Corrected PDF page count changed.')
        if old_code in rewritten_text:
            raise RuntimeError(f'Corrected PDF still contains {old_code}.')
        expected_new = new_count_before + old_count
        actual_new = rewritten_text.count(new_code)
        if actual_new != expected_new:
            raise RuntimeError(
                f'Corrected PDF contains {actual_new} occurrences of {new_code}; expected {expected_new}.'
            )
    finally:
        check.close()

    print(f'source_sha256={source_hash}')
    print(f'output_sha256={sha256_file(output)}')
    print(f'replacements={old_count}')
    print(f'pages={original_pages}')
    print('mode=rewritten')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('old_code')
    parser.add_argument('new_code')
    args = parser.parse_args()
    build(args.source, args.output, args.old_code, args.new_code)


if __name__ == '__main__':
    main()
