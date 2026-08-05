"""Local, bounded OCR fallback for operator-authorized broker PDF reports."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

from collectors.common import ROOT

WINDOWS_OCR_SCRIPT = ROOT / "scripts" / "windows_ocr.ps1"
DEFAULT_DPI = 150
DEFAULT_MAX_PAGES = 24


def usable_report_text(text: str, *, minimum_alnum: int = 120) -> bool:
    """Reject bullet-only/font-map failures while allowing bounded short notes."""
    return sum(character.isalnum() for character in text) >= minimum_alnum


def _pdftoppm_path() -> str:
    configured = os.getenv("PDFTOPPM_BIN", "").strip()
    if configured and Path(configured).exists():
        return configured
    if os.name == "nt":
        bundled = (
            Path.home()
            / ".cache"
            / "codex-runtimes"
            / "codex-primary-runtime"
            / "dependencies"
            / "native"
            / "poppler"
            / "Library"
            / "bin"
            / "pdftoppm.exe"
        )
        if bundled.exists():
            return str(bundled)
    discovered = shutil.which("pdftoppm")
    if discovered:
        return discovered
    raise RuntimeError("PDF OCR requires pdftoppm (Poppler)")


def _tesseract_text(image_path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return ""
    if not shutil.which("tesseract"):
        return ""
    language = os.getenv("BROKER_REPORT_OCR_LANG", "kor+eng").strip() or "kor+eng"
    with Image.open(image_path) as image:
        return str(pytesseract.image_to_string(image, lang=language) or "")


def _windows_ocr_text(image_path: Path) -> str:
    if os.name != "nt" or not WINDOWS_OCR_SCRIPT.exists():
        return ""
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        return ""
    completed = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(WINDOWS_OCR_SCRIPT),
            "-ImagePath",
            str(image_path),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=90,
    )
    return completed.stdout


def _ocr_image(image_path: Path) -> str:
    text = _tesseract_text(image_path)
    if usable_report_text(text, minimum_alnum=40):
        return text
    text = _windows_ocr_text(image_path)
    if usable_report_text(text, minimum_alnum=40):
        return text
    return ""


def ocr_pdf_text(payload: bytes, *, max_chars: int = 30_000) -> str:
    """Render and OCR a private PDF without writing its body outside temp storage."""
    reader = PdfReader(BytesIO(payload))
    page_limit = min(
        len(reader.pages),
        max(1, int(os.getenv("BROKER_REPORT_OCR_MAX_PAGES", DEFAULT_MAX_PAGES))),
    )
    dpi = max(96, int(os.getenv("BROKER_REPORT_OCR_DPI", DEFAULT_DPI)))
    renderer = _pdftoppm_path()
    pages: list[str] = []
    with tempfile.TemporaryDirectory(prefix="broker-report-ocr-") as directory:
        root = Path(directory)
        pdf_path = root / "report.pdf"
        pdf_path.write_bytes(payload)
        for page_number in range(1, page_limit + 1):
            image_prefix = root / f"page-{page_number:03d}"
            subprocess.run(
                [
                    renderer,
                    "-f",
                    str(page_number),
                    "-l",
                    str(page_number),
                    "-singlefile",
                    "-png",
                    "-r",
                    str(dpi),
                    str(pdf_path),
                    str(image_prefix),
                ],
                check=True,
                capture_output=True,
                timeout=90,
            )
            text = _ocr_image(image_prefix.with_suffix(".png")).strip()
            if text:
                pages.append(text)
            if sum(len(page) for page in pages) >= max_chars:
                break
    combined = "\n\n".join(pages).strip()
    if not usable_report_text(combined):
        raise ValueError("Broker report OCR produced no usable text")
    return combined[:max_chars]
