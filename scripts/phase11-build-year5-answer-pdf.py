#!/usr/bin/env python3

import argparse
import hashlib
from pathlib import Path

import fitz

EXPECTED_SOURCE_SHA256 = "e1b900264b562abfe561a0cd8149ccce991f69876f02690f6def9a6f535277e5"
OLD_CODE = "L2T1M01"
NEW_CODE = "Y5T1M01"
EXPECTED_PAGES = 3
EXPECTED_OCCURRENCES = 6


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def replacement_spans(page):
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if OLD_CODE in span.get("text", ""):
                    spans.append(span)
    return spans


def build(source: Path, output: Path):
    source_hash = sha256_file(source)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            f"Refusing source with unexpected SHA-256: {source_hash}; "
            f"expected {EXPECTED_SOURCE_SHA256}"
        )

    document = fitz.open(source)
    try:
        if document.page_count != EXPECTED_PAGES:
            raise RuntimeError(
                f"Expected {EXPECTED_PAGES} pages, found {document.page_count}"
            )

        total = 0
        for page_number, page in enumerate(document, start=1):
            spans = replacement_spans(page)
            if len(spans) != 2:
                raise RuntimeError(
                    f"Page {page_number}: expected two {OLD_CODE} spans, found {len(spans)}"
                )
            total += len(spans)

            for span in spans:
                rect = fitz.Rect(span["bbox"])
                rect.x0 -= 1.5
                rect.x1 += 1.5
                rect.y0 -= 1.0
                rect.y1 += 1.0
                page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

            for span in spans:
                new_text = span["text"].replace(OLD_CODE, NEW_CODE)
                font = span["font"]
                size = float(span["size"])
                packed = int(span["color"])
                color = (
                    ((packed >> 16) & 255) / 255,
                    ((packed >> 8) & 255) / 255,
                    (packed & 255) / 255,
                )
                old_rect = fitz.Rect(span["bbox"])
                new_width = fitz.get_text_length(new_text, fontname=font, fontsize=size)
                if size >= 15:
                    center = (old_rect.x0 + old_rect.x1) / 2
                    x = center - new_width / 2
                else:
                    x = old_rect.x1 - new_width
                y = float(span["origin"][1])
                page.insert_text(
                    (x, y),
                    new_text,
                    fontname=font,
                    fontsize=size,
                    color=color,
                    overlay=True,
                )

        if total != EXPECTED_OCCURRENCES:
            raise RuntimeError(
                f"Expected {EXPECTED_OCCURRENCES} replacements, performed {total}"
            )

        output.parent.mkdir(parents=True, exist_ok=True)
        document.save(output, garbage=4, deflate=True, clean=True)
    finally:
        document.close()

    check = fitz.open(output)
    try:
        text = "\n".join(page.get_text("text") for page in check)
        if OLD_CODE in text:
            raise RuntimeError(f"Corrected PDF still contains {OLD_CODE}")
        if text.count(NEW_CODE) != EXPECTED_OCCURRENCES:
            raise RuntimeError(
                f"Corrected PDF contains {text.count(NEW_CODE)} {NEW_CODE} occurrences; "
                f"expected {EXPECTED_OCCURRENCES}"
            )
        if check.page_count != EXPECTED_PAGES:
            raise RuntimeError("Corrected PDF page count changed")
    finally:
        check.close()

    print(f"source_sha256={source_hash}")
    print(f"output_sha256={sha256_file(output)}")
    print(f"replacements={EXPECTED_OCCURRENCES}")
    print(f"pages={EXPECTED_PAGES}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)


if __name__ == "__main__":
    main()
