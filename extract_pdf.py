"""Read PDF text and render scanned pages. Uploaded files stay in memory."""
import base64
import io
import json
import sys
from pypdf import PdfReader


def extract_document(data):
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("This PDF is password-protected. Upload an unlocked copy.")
    pages = []
    document = None
    try:
        for index, page in enumerate(reader.pages):
            text = page.extract_text(extraction_mode="layout") or ""
            result = {"text": text.strip()}
            if not text.strip() or (len(text.strip()) < 300 and len(page.images) > 0):
                if document is None:
                    import pypdfium2
                    document = pypdfium2.PdfDocument(data)
                scan = document[index]
                width, height = scan.get_size()
                scale = min(2, 1600 / width, 2200 / height)
                bitmap = scan.render(scale=scale)
                image = bitmap.to_pil().convert("RGB")
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=90)
                result["image"] = base64.b64encode(output.getvalue()).decode("ascii")
                bitmap.close()
                scan.close()
            pages.append(result)
    finally:
        if document is not None:
            document.close()
    return {"pages": pages}


if __name__ == "__main__":
    try:
        result = extract_document(sys.stdin.buffer.read())
    except ValueError as error:
        result = {"error": str(error)}
    except ImportError:
        result = {"error": "PDF reading needs pypdf and pypdfium2 in the configured Python installation."}
    except Exception:
        result = {"error": "Could not open this PDF. Check that the file is a valid, unlocked PDF."}
    # Write UTF-8 bytes explicitly: Windows' default encoding breaks lab symbols and Hindi.
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
